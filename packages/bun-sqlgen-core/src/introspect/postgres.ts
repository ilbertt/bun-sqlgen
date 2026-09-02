import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '#introspect/migrations.ts';
import { parseRelations } from '#introspect/sql-text.ts';
import { oidToTs, PG_OID } from '#oids.ts';
import type {
  Catalog,
  ColumnSource,
  DescribeResult,
  Introspector,
  IntrospectorOptions,
  Provenance,
  RawColumnComments,
  RelationKind,
  ResultField,
  SchemaColumn,
  SchemaTable,
  TypeCatalog,
  TypeInfo,
  ViewColumns,
  WritableColumns,
} from '#types.ts';

/** In-process Postgres (PGlite) with migrations applied — the build-time DB. */
export async function createPostgresIntrospector(opts: IntrospectorOptions): Promise<Introspector> {
  const extensions = opts.extensions ? await opts.extensions() : undefined;
  const db = new PGlite(extensions ? { extensions } : undefined);

  if (opts.prelude) {
    await db.exec(opts.prelude);
  }
  await applyMigrations({
    migrationsDir: opts.migrationsDir,
    exec: (sql) => db.exec(sql).then(() => undefined),
    transformMigration: opts.transformMigration,
  });

  // Dynamic OIDs (enum/domain/array) resolved once and reused across describes.
  let typeCatalog: TypeCatalog | null = null;
  async function getTypes(): Promise<TypeCatalog> {
    typeCatalog ??= await loadTypes(db);
    return typeCatalog;
  }

  // The views a query could be naming, resolved once. Only plain views: a materialized
  // view is a real relation, so the plan names it and provenance finds it unaided.
  let views: Map<string, string> | null = null;
  async function getViews(): Promise<Map<string, string>> {
    views ??= await loadViews(db);
    return views;
  }

  async function describe(sql: string): Promise<DescribeResult> {
    const types = await getTypes();
    const knownViews = await getViews();
    // describeQuery throws the real Postgres error on bad SQL.
    const d = await db.describeQuery(sql);
    const params = d.queryParams.map((p) => p.dataTypeID);
    const fields: ResultField[] = d.resultFields.map((field): ResultField => {
      const { ts, note } = oidToTs({ oid: field.dataTypeID, types });
      return { name: field.name, ts, tsNote: note };
    });

    // EXPLAIN with a non-null dummy per param: NULL would short-circuit `col = NULL`
    // and let the planner prune the scans we read provenance from.
    let provenance: Provenance[] | null = null;
    let relations: string[] = [];
    try {
      const dummies = params.map(dummyForOid);
      const r = await db.query<ExplainRow>(`EXPLAIN (VERBOSE, FORMAT JSON) ${sql}`, dummies);
      const plan = r.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (plan) {
        const analyzed = analyzePlan({ plan, fieldCount: fields.length });
        provenance = analyzed.provenance;
        relations = analyzed.relations;
      }
    } catch {
      provenance = null; // everything falls back to nullable
    }
    return {
      fields,
      provenance,
      relations,
      views: parseRelations(sql).filter((r) => knownViews.has(r)),
    };
  }

  // Every view's columns, each traced to the base column it passes through. Describing
  // `SELECT *` puts the view's own body through the same plan analysis a query gets, so
  // a pass-through column reports the base column it reads and a computed one reports
  // an expression — exactly the distinction that decides how a comment on it matches.
  async function viewColumns(): Promise<ViewColumns> {
    const map: ViewColumns = Object.create(null);
    for (const [name, qualified] of await getViews()) {
      try {
        const described = await describe(`SELECT * FROM ${qualified}`);
        // biome-ignore lint/complexity/useMaxParams: native map callback needs the index
        map[name] = described.fields.map((field, i) => ({
          column: field.name,
          source: passThrough(described.provenance?.[i]),
        }));
      } catch {
        // A view that can't be described maps to nothing; its comments still match by name.
      }
    }
    return map;
  }

  // Per-column NOT NULL — the piece describeQuery can't give us.
  // Relation and column names come from the schema, and `__proto__` is a legal one:
  // on an ordinary object it is the prototype accessor, so `map[name] ??= …` never
  // assigns and the later `.push`/lookup fails. A null-prototype record has no such key.
  async function catalog(): Promise<Catalog> {
    const r = await db.query<CatalogRow>(`
      SELECT table_name, column_name, (is_nullable = 'NO') AS not_null
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    const map: Catalog = Object.create(null);
    for (const row of r.rows) {
      map[row.table_name] ??= Object.create(null);
      map[row.table_name]![row.column_name] = row.not_null;
    }
    return map;
  }

  // Per-column `COMMENT ON COLUMN` text — a place to declare schema-level
  // `@notNull`/`@nullable`/`@type` overrides once, instead of per query.
  async function columnComments(): Promise<RawColumnComments> {
    const r = await db.query<CommentRow>(`
      SELECT c.relname AS table_name, a.attname AS column_name, d.description
      FROM pg_description d
      JOIN pg_class c ON c.oid = d.objoid
      JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.objsubid > 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    `);
    const map: RawColumnComments = Object.create(null);
    for (const row of r.rows) {
      map[row.table_name] ??= Object.create(null);
      map[row.table_name]![row.column_name] = row.description;
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
    const map: WritableColumns = Object.create(null);
    for (const row of r.rows) {
      map[row.table_name] ??= [];
      map[row.table_name]!.push(row.column_name);
    }
    return map;
  }

  // The schema block: every table and view with its columns typed exactly as a query
  // selecting them would be, plus the names of its indexes and constraints.
  async function tables(): Promise<SchemaTable[]> {
    const types = await getTypes();
    // `pg_attribute` rather than `information_schema.columns`: it carries the type OID,
    // so columns resolve through the same mapper the result fields use.
    const cols = await db.query<RelationColumnRow>(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind, a.attname AS column_name,
             a.atttypid AS type_oid, a.attnotnull AS not_null
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname, a.attnum
    `);
    const byRelation = new Map<string, SchemaTable>();
    const byColumn = new Map<string, SchemaColumn>();
    for (const row of cols.rows) {
      let table = byRelation.get(qualified(row));
      if (!table) {
        table = {
          name: row.table_name,
          kind: RELATION_KIND[row.relkind] ?? 'table',
          columns: [],
          indexes: [],
          constraints: [],
        };
        byRelation.set(qualified(row), table);
      }
      const { ts, note } = oidToTs({ oid: Number(row.type_oid), types });
      const column: SchemaColumn = {
        name: row.column_name,
        ts,
        tsNote: note,
        notNull: row.not_null,
        foreignKeys: [],
      };
      table.columns.push(column);
      byColumn.set(`${qualified(row)}.${row.column_name}`, column);
    }

    const indexes = await db.query<RelationIndexRow>(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, i.relname AS index_name
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname, i.relname
    `);
    for (const row of indexes.rows) {
      byRelation.get(qualified(row))?.indexes.push(row.index_name);
    }

    // Primary key, unique, foreign key, check and exclusion constraints — the ones a
    // user names and refers to. Trigger and not-null constraints carry generated names.
    const constraints = await db.query<RelationConstraintRow>(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype IN ('p', 'u', 'f', 'c', 'x')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname, con.conname
    `);
    for (const row of constraints.rows) {
      byRelation.get(qualified(row))?.constraints.push(row.constraint_name);
    }

    // `unnest(conkey, confkey)` walks the two attnum arrays in lockstep, so a composite
    // key pairs each of its columns with the one it actually points at.
    const foreignKeys = await db.query<RelationForeignKeyRow>(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
             att.attname AS column_name, fc.relname AS ref_table_name,
             fatt.attname AS ref_column_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class fc ON fc.oid = con.confrelid
      JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
        ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = k.fattnum
      WHERE con.contype = 'f'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname, con.conname, k.ord
    `);
    for (const row of foreignKeys.rows) {
      byColumn.get(`${qualified(row)}.${row.column_name}`)?.foreignKeys.push({
        name: row.constraint_name,
        references: { table: row.ref_table_name, column: row.ref_column_name },
      });
    }

    // The rest of the pipeline keys relations by bare name (as `catalog()` does), so a
    // table shadowed by a same-named one in another schema collapses onto the last seen.
    return [...new Map([...byRelation.values()].map((t) => [t.name, t])).values()];
  }

  return {
    describe,
    catalog,
    columnComments,
    viewColumns,
    writableColumns,
    tables,
    close: () => db.close(),
  };
}

// The base column a view column reads straight through. A computed column reaches the
// plan as its expression, and so carries no single column to attribute it to.
const passThrough = (prov: Provenance | undefined): ColumnSource | undefined =>
  prov?.kind === 'column' && prov.table ? { table: prov.table, column: prov.column } : undefined;

// Plain views only, keyed by the bare name the rest of the pipeline uses and valued by
// the qualified one it takes to select from them unambiguously.
async function loadViews(db: PGlite): Promise<Map<string, string>> {
  const r = await db.query<ViewRow>(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname
  `);
  return new Map(
    r.rows.map((row) => [
      row.table_name,
      `${quoteIdent(row.schema_name)}.${quoteIdent(row.table_name)}`,
    ]),
  );
}

const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;

const qualified = (row: { schema_name: string; table_name: string }): string =>
  `${row.schema_name}.${row.table_name}`;

// Dynamic OIDs (enum/domain/array) a static table can't know: read their
// labels/base/element from the catalog so the mapper can recurse to a leaf.
async function loadTypes(db: PGlite): Promise<TypeCatalog> {
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

interface CommentRow {
  table_name: string;
  column_name: string;
  description: string;
}

interface ViewRow {
  schema_name: string;
  table_name: string;
}

interface WritableRow {
  table_name: string;
  column_name: string;
}

// `relkind` as the generated module reports it. A partitioned table ('p') is still a
// table; only a materialized view carries both a view's definition and real indexes.
const RELATION_KIND: Record<string, RelationKind> = {
  r: 'table',
  p: 'table',
  v: 'view',
  m: 'materialized_view',
};

interface RelationColumnRow {
  schema_name: string;
  table_name: string;
  relkind: string;
  column_name: string;
  type_oid: number;
  not_null: boolean;
}

interface RelationIndexRow {
  schema_name: string;
  table_name: string;
  index_name: string;
}

interface RelationConstraintRow {
  schema_name: string;
  table_name: string;
  constraint_name: string;
}

interface RelationForeignKeyRow extends RelationConstraintRow {
  column_name: string;
  ref_table_name: string;
  ref_column_name: string;
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
    case PG_OID.uuid:
      return '00000000-0000-0000-0000-000000000000';
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
function analyzePlan(input: { plan: PlanNode; fieldCount: number }): {
  provenance: Provenance[];
  relations: string[];
} {
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
  const provenance = output.map((raw): Provenance => {
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
    // Functions, OVER(), literals, CASE, casts — and generated columns, which reach the
    // plan as the expression that generates them.
    return { kind: 'expr', expr, ...expressionOrigin({ expr, aliasToRel, nullableAliases }) };
  });
  return { provenance, relations };
}

const QUALIFIED_REF = /\b([a-zA-Z_][\w$]*)\.[a-zA-Z_][\w$]*/g;
// A quoted literal can hold anything that looks like `alias.column` (`'u.email'::text`),
// so it is blanked before the scan rather than read as a reference.
const SQL_STRING = /'(?:[^']|'')*'/g;

/**
 * The relation an expression reads from, when all of its inputs agree on one.
 * Postgres qualifies an expression's column references (`uuid_extract_timestamp(a.id)`)
 * exactly when more than one relation is in scope — which is exactly when matching a
 * comment override by column name alone would be ambiguous. Names that aren't aliases
 * in this plan (a schema-qualified function like `paradedb.score(…)`) are ignored.
 */
function expressionOrigin(input: {
  expr: string;
  aliasToRel: Record<string, string>;
  nullableAliases: Set<string>;
}): { relation?: string; outerNullable: boolean } {
  const scanned = input.expr.replace(SQL_STRING, "''");
  const aliases = [...new Set([...scanned.matchAll(QUALIFIED_REF)].map((m) => m[1]!))].filter(
    (alias) => alias in input.aliasToRel,
  );
  // Whether any input is on the nullable side is knowable even when the inputs span
  // several relations — and it has to be reported, or a comment matched by name alone
  // would type an outer-joined column as non-null.
  const outerNullable = aliases.some((alias) => input.nullableAliases.has(alias));
  const relations = [...new Set(aliases.map((alias) => input.aliasToRel[alias]!))];
  if (relations.length !== 1) {
    return { outerNullable };
  }
  return { relation: relations[0], outerNullable };
}
