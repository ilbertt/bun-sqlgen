import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Extensions, PGlite } from '@electric-sql/pglite';
import { PG_OID } from '#oids.ts';
import type {
  Catalog,
  DescribeResult,
  Provenance,
  ResultField,
  TypeCatalog,
  TypeInfo,
  WritableColumns,
} from '#types.ts';

/** In-process Postgres (PGlite) with migrations applied — the build-time DB. */
export interface Introspector {
  describe: (sql: string) => Promise<DescribeResult>;
  catalog: () => Promise<Catalog>;
  types: () => Promise<TypeCatalog>;
  writableColumns: () => Promise<WritableColumns>;
  close: () => Promise<void>;
}

export interface IntrospectorOptions {
  migrationsDir: string;
  extensions?: () => Extensions | Promise<Extensions>;
  prelude?: string;
  transformMigration?: (input: { sql: string; filename: string }) => string;
}

export async function createIntrospector(opts: IntrospectorOptions): Promise<Introspector> {
  const extensions = opts.extensions ? await opts.extensions() : undefined;
  const db = new PGlite(extensions ? { extensions } : undefined);

  if (opts.prelude) {
    await db.exec(opts.prelude);
  }

  // Apply migrations in filename order (exec runs multi-statement SQL).
  const files = readdirSync(opts.migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const filename of files) {
    try {
      let sql = readFileSync(join(opts.migrationsDir, filename), 'utf8');
      if (opts.transformMigration) {
        sql = opts.transformMigration({ sql, filename });
      }
      await db.exec(sql);
    } catch (e) {
      throw new Error(`migration ${filename} failed to apply: ${firstLine(e)}`);
    }
  }

  async function describe(sql: string): Promise<DescribeResult> {
    // describeQuery throws the real Postgres error on bad SQL.
    const d = await db.describeQuery(sql);
    const params = d.queryParams.map((p) => p.dataTypeID);
    const fields: ResultField[] = d.resultFields.map((f) => ({ name: f.name, oid: f.dataTypeID }));

    // EXPLAIN with a non-null dummy per param: NULL would short-circuit `col = NULL`
    // and let the planner prune the scans we read provenance from.
    let provenance: Provenance[] | null = null;
    try {
      const dummies = params.map(dummyForOid);
      const r = await db.query<ExplainRow>(`EXPLAIN (VERBOSE, FORMAT JSON) ${sql}`, dummies);
      const plan = r.rows[0]?.['QUERY PLAN'][0]?.Plan;
      provenance = plan ? analyzePlan({ plan, fieldCount: fields.length }) : null;
    } catch {
      provenance = null; // everything falls back to nullable
    }
    return { params, fields, provenance };
  }

  // Per-column NOT NULL — the piece describeQuery can't give us.
  async function catalog(): Promise<Catalog> {
    const r = await db.query<CatalogRow>(`
      SELECT table_name, column_name, (is_nullable = 'NO') AS not_null
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    const map: Catalog = {};
    for (const row of r.rows) {
      map[row.table_name] ??= {};
      map[row.table_name]![row.column_name] = row.not_null;
    }
    return map;
  }

  // Writable columns (not identity/generated) for `SET col = col` neutralization,
  // which identity/generated columns reject.
  async function writableColumns(): Promise<WritableColumns> {
    const r = await db.query<WritableRow>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND is_identity = 'NO' AND is_generated = 'NEVER'
      ORDER BY table_name, ordinal_position
    `);
    const map: WritableColumns = {};
    for (const row of r.rows) {
      map[row.table_name] ??= [];
      map[row.table_name]!.push(row.column_name);
    }
    return map;
  }

  // Dynamic OIDs (enum/domain/array) a static table can't know: read their
  // labels/base/element from the catalog so the mapper can recurse to a leaf.
  async function types(): Promise<TypeCatalog> {
    const t = await db.query<PgTypeRow>(`
      SELECT oid, typname, typtype, typbasetype, typelem, typcategory
      FROM pg_type
    `);
    const e = await db.query<PgEnumRow>(`
      SELECT enumtypid, enumlabel FROM pg_enum ORDER BY enumsortorder
    `);
    const labels = new Map<number, string[]>();
    for (const row of e.rows) {
      const oid = Number(row.enumtypid);
      const existing = labels.get(oid) ?? [];
      existing.push(row.enumlabel);
      labels.set(oid, existing);
    }

    const map: TypeCatalog = new Map();
    for (const row of t.rows) {
      const oid = Number(row.oid);
      let info: TypeInfo;
      if (row.typtype === 'e') {
        info = { kind: 'enum', name: row.typname, labels: labels.get(oid) ?? [] };
      } else if (row.typtype === 'd') {
        info = { kind: 'domain', name: row.typname, baseOid: Number(row.typbasetype) };
      } else if (row.typcategory === 'A' && Number(row.typelem) !== 0) {
        info = { kind: 'array', name: row.typname, elemOid: Number(row.typelem) };
      } else {
        info = { kind: 'base', name: row.typname };
      }
      map.set(oid, info);
    }
    return map;
  }

  return { describe, catalog, types, writableColumns, close: () => db.close() };
}

// ---- EXPLAIN plan typing ----------------------------------------------------

interface PlanNode {
  'Relation Name'?: string;
  Alias?: string;
  'Join Type'?: string;
  Output?: string[];
  Plans?: PlanNode[];
}

interface ExplainRow {
  'QUERY PLAN': Array<{ Plan: PlanNode }>;
}

interface CatalogRow {
  table_name: string;
  column_name: string;
  not_null: boolean;
}

interface WritableRow {
  table_name: string;
  column_name: string;
}

interface PgTypeRow {
  oid: number;
  typname: string;
  typtype: string;
  typbasetype: number;
  typelem: number;
  typcategory: string;
}

interface PgEnumRow {
  enumtypid: number;
  enumlabel: string;
}

type Dummy = boolean | string | number | Uint8Array;

// A safe, non-null value for each common param type so EXPLAIN keeps the scans.
function dummyForOid(oid: number): Dummy {
  switch (oid) {
    case PG_OID.bool:
      return false;
    case PG_OID.date:
      return '2000-01-01';
    case PG_OID.time:
      return '00:00:00';
    case PG_OID.timestamp:
    case PG_OID.timestamptz:
      return '2000-01-01T00:00:00Z';
    case PG_OID.json:
    case PG_OID.jsonb:
      return '{}';
    case PG_OID.bytea:
      return new Uint8Array();
    case PG_OID.int8:
    case PG_OID.int2:
    case PG_OID.int4:
    case PG_OID.oid:
    case PG_OID.float4:
    case PG_OID.float8:
    case PG_OID.numeric:
      return 0;
    default:
      return '';
  }
}

const QUALIFIED_COLUMN = /^([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)$/;
const BARE_COLUMN = /^[a-zA-Z_][\w$]*$/;

// A binary join's plan inputs: the outer (preserved) side first, inner second.
const OUTER_INPUT = 0;
const INNER_INPUT = 1;

// Map alias->relation and the aliases on the nullable side of an outer join, then
// align the top Output list (SELECT order) with the result fields.
function analyzePlan(input: { plan: PlanNode; fieldCount: number }): Provenance[] {
  const { plan, fieldCount } = input;
  const aliasToRel: Record<string, string> = {};
  const nullableAliases = new Set<string>();

  // biome-ignore lint/complexity/useMaxParams: tight recursive closure reads cleaner positionally
  const walk = (node: PlanNode, underOuter: boolean): void => {
    const relation = node['Relation Name'];
    if (relation && node.Alias) {
      aliasToRel[node.Alias] = relation;
      if (underOuter) {
        nullableAliases.add(node.Alias);
      }
    }
    const jt = node['Join Type']; // "Inner" | "Left" | "Right" | "Full" | ...
    const children = node.Plans ?? [];
    // biome-ignore lint/complexity/useMaxParams: native forEach callback needs the input index
    children.forEach((child, i) => {
      // LEFT → inner side nullable; RIGHT → outer; FULL → both (conservative).
      const childOuter =
        underOuter ||
        (jt === 'Left' && i === INNER_INPUT) ||
        (jt === 'Right' && i === OUTER_INPUT) ||
        jt === 'Full';
      walk(child, childOuter);
    });
  };
  walk(plan, false);

  const relations = [...new Set(Object.values(aliasToRel))];
  const nonNullableRelations = relations.filter(
    (rel) => ![...nullableAliases].some((a) => aliasToRel[a] === rel),
  );

  const output = (plan.Output ?? []).slice(0, fieldCount);
  return output.map((raw): Provenance => {
    const expr = raw.trim();
    // Qualified column: `u.email`.
    const q = QUALIFIED_COLUMN.exec(expr);
    if (q) {
      const alias = q[1]!;
      const column = q[2]!;
      return {
        kind: 'column',
        column,
        table: aliasToRel[alias] ?? null,
        outerNullable: nullableAliases.has(alias),
      };
    }
    // Bare column: defer table resolution to the catalog step (pass the candidates).
    if (BARE_COLUMN.test(expr)) {
      return {
        kind: 'column',
        column: expr,
        table: null,
        candidates: relations,
        outerNullable: relations.length > 0 && nonNullableRelations.length === 0,
      };
    }
    // Functions, OVER(), literals, CASE, casts.
    return { kind: 'expr', expr };
  });
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0] ?? message;
}
