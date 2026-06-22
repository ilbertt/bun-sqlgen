import { Database } from 'bun:sqlite';
import { applyMigrations } from '#introspect/migrations.ts';
import type { TsType } from '#oids.ts';
import type {
  Catalog,
  DescribeResult,
  Introspector,
  IntrospectorOptions,
  Provenance,
  RawColumnComments,
  ResultField,
  WritableColumns,
} from '#types.ts';

/**
 * In-memory SQLite (`bun:sqlite`) with migrations applied — the build-time DB, the
 * analog of PGlite for the Postgres dialect. SQLite has no "describe without
 * executing" protocol, so each query's result columns come from a prepared
 * statement's metadata: `columnNames`, `declaredTypes` (a declared type per column,
 * `null` for expressions — our column-vs-expression signal), and `columnTypes` (the
 * storage class of the first row, a fallback for expressions over a non-empty
 * result). Provenance is reconstructed from declared-type presence plus a FROM/JOIN
 * scan, then fed through the same nullability engine as Postgres.
 */
export async function createSqliteIntrospector(opts: IntrospectorOptions): Promise<Introspector> {
  const db = new Database(':memory:');

  if (opts.prelude) {
    db.run(opts.prelude);
  }
  await applyMigrations({
    migrationsDir: opts.migrationsDir,
    exec: (sql) => {
      db.run(sql);
    },
    transformMigration: opts.transformMigration,
  });

  // Synchronous (bun:sqlite is sync) but returns a Promise to satisfy the
  // dialect-agnostic Introspector interface.
  function describe(sql: string): Promise<DescribeResult> {
    const stmt = db.prepare(sql); // throws the real SQLite error on bad SQL
    try {
      const names = stmt.columnNames;
      const paramsCount = stmt.paramsCount;

      // `declaredTypes` needs the statement executed once. Run it with NULL params
      // inside a rolled-back savepoint: a successful DML can't mutate the build DB,
      // and a failing one (e.g. a NOT NULL on INSERT) still populates the metadata.
      db.run('SAVEPOINT sqlgen_describe');
      try {
        stmt.run(...Array.from({ length: paramsCount }, () => null));
      } catch {
        // execution may fail; the declared types we need are set regardless.
      } finally {
        db.run('ROLLBACK TO sqlgen_describe');
        db.run('RELEASE sqlgen_describe');
      }

      const decl = readMeta(() => stmt.declaredTypes);
      // `columnTypes` is only available for read-only statements; absent otherwise.
      const storage = readMeta(() => stmt.columnTypes);

      const relations = parseRelations(sql);
      const outerNullable = hasOuterJoin(sql);

      const fields: ResultField[] = [];
      const provenance: Provenance[] = [];
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        const declared = decl[i] ?? null;
        const { ts, note } = fieldType({ declared, storage: storage[i] ?? null });
        fields.push({ name, ts, tsNote: note });
        // A declared type means a real table column; trace it by name (the catalog
        // step resolves the owning relation). No declared type → an expression.
        provenance.push(
          declared
            ? { kind: 'column', column: name, table: null, candidates: relations, outerNullable }
            : { kind: 'expr', expr: name },
        );
      }
      return Promise.resolve({ fields, provenance, relations });
    } finally {
      stmt.finalize();
    }
  }

  // Per-column NOT NULL, from `PRAGMA table_info`. An `INTEGER PRIMARY KEY` is a
  // rowid alias and implicitly NOT NULL even when `notnull` reads 0.
  function catalog(): Promise<Catalog> {
    const map: Catalog = {};
    for (const table of listNames(['table', 'view'])) {
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as TableInfoRow[];
      map[table] = {};
      for (const c of cols) {
        map[table]![c.name] = c.notnull === 1 || (c.pk > 0 && /INT/i.test(c.type));
      }
    }
    return Promise.resolve(map);
  }

  // SQLite has no column comments, so schema-level `@type`/`@notNull` overrides are
  // unavailable; per-query `@notNull`/`@nullable` annotations still apply.
  function columnComments(): Promise<RawColumnComments> {
    return Promise.resolve({});
  }

  // Writable columns (not generated) for `SET col = col` neutralization. `hidden`
  // from `table_xinfo`: 0 = ordinary, 2 = VIRTUAL, 3 = STORED generated column.
  function writableColumns(): Promise<WritableColumns> {
    const map: WritableColumns = {};
    for (const table of listNames(['table'])) {
      const cols = db.prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`).all() as TableXInfoRow[];
      map[table] = cols.filter((c) => c.hidden === 0).map((c) => c.name);
    }
    return Promise.resolve(map);
  }

  function listNames(kinds: string[]): string[] {
    const inList = kinds.map((k) => `'${k}'`).join(', ');
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN (${inList}) AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  return {
    describe,
    catalog,
    columnComments,
    writableColumns,
    close: () => Promise.resolve(db.close()),
  };
}

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface TableXInfoRow {
  name: string;
  hidden: number;
}

// Read a prepared-statement metadata array, tolerating the getters that throw
// (e.g. `columnTypes` on a non-read-only statement).
function readMeta<T>(get: () => Array<T>): Array<T> {
  try {
    return get();
  } catch {
    return [];
  }
}

const OUTER_JOIN = /\b(?:left|right|full)\s+(?:outer\s+)?join\b/i;

// Conservative: any outer join makes every traced column nullable, since without
// column-origin metadata we can't tell which side of the join a column came from.
function hasOuterJoin(sql: string): boolean {
  return OUTER_JOIN.test(sql);
}

const IDENT = String.raw`"[^"]*"|\`[^\`]*\`|\[[^\]]*\]|[A-Za-z_]\w*`;
const FROM_JOIN = new RegExp(String.raw`\b(?:from|join)\s+(${IDENT})(?:\s*\.\s*(${IDENT}))?`, 'gi');

// Base relations in scope, scanned from FROM/JOIN clauses. Subqueries (next token is
// `(`) are skipped; CTE names that slip through simply miss in the catalog. Used to
// resolve bare result columns to their owning table.
function parseRelations(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(FROM_JOIN)) {
    out.add(unquoteIdent(m[2] ?? m[1]!)); // `schema.table` → table
  }
  return [...out];
}

function unquoteIdent(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  if (s.startsWith('`') && s.endsWith('`')) {
    return s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1);
  }
  return s;
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// Resolve a column's TS type to what `Bun.SQL` (sqlite) actually returns at runtime:
// declared type by affinity, with `columnTypes`' storage class as the expression
// fallback. BOOLEAN/BIGINT come back as `number`, DATE/DATETIME as the stored string.
function fieldType(input: { declared: string | null; storage: string | null }): TsType {
  const { declared, storage } = input;
  if (declared) {
    return declToTs(declared);
  }
  return storageToTs(storage);
}

function declToTs(decl: string): TsType {
  const d = decl.toUpperCase();
  if (d.includes('INT')) {
    return { ts: 'number' };
  }
  if (/CHAR|CLOB|TEXT/.test(d)) {
    return { ts: 'string' };
  }
  if (d.includes('BLOB')) {
    return { ts: 'Uint8Array' };
  }
  if (/REAL|FLOA|DOUB/.test(d)) {
    return { ts: 'number' };
  }
  // NUMERIC-affinity declared types that `Bun.SQL` returns as strings, not numbers.
  if (/DATE|TIME/.test(d)) {
    return { ts: 'string' };
  }
  if (d.includes('BOOL') || /NUMERIC|DEC|NUM|MONEY/.test(d)) {
    return { ts: 'number' };
  }
  return { ts: 'unknown', note: `unmapped sqlite type "${decl}"` };
}

function storageToTs(storage: string | null): TsType {
  switch (storage) {
    case 'INTEGER':
    case 'FLOAT':
      return { ts: 'number' };
    case 'TEXT':
      return { ts: 'string' };
    case 'BLOB':
      return { ts: 'Uint8Array' };
    default:
      // NULL storage (e.g. an expression over an empty build DB) carries no type.
      return { ts: 'unknown' };
  }
}
