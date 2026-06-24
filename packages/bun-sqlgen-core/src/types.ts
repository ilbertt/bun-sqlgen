import type { Extensions } from '@electric-sql/pglite';

/** A Postgres type OID resolved to the shape the TS mapper needs. */
export type TypeInfo =
  | { kind: 'base'; name: string }
  | { kind: 'enum'; name: string; labels: string[] }
  | { kind: 'domain'; name: string; baseOid: number }
  | { kind: 'array'; name: string; elemOid: number };

/** OID -> its resolved description, for the dynamic types (enum/domain/array). */
export type TypeCatalog = Map<number, TypeInfo>;

/** table -> column -> whether the column is `NOT NULL` in the schema. */
export type Catalog = Record<string, Record<string, boolean>>;

/** table -> writable columns (not identity, not generated), in column order. */
export type WritableColumns = Record<string, string[]>;

export interface ResultField {
  name: string;
  /** TS type for the column, already resolved by the dialect's introspector. */
  ts: string;
  /** Set when the type couldn't be mapped — emitted as a trailing comment on the field. */
  tsNote?: string;
}

/**
 * Where an output column came from, traced through the plan. A `column` is a
 * base-table column (possibly on the nullable side of an outer join); anything
 * else (functions, CASE, casts, aggregates) is an opaque `expr`.
 */
export type Provenance =
  | {
      kind: 'column';
      column: string;
      table: string | null;
      outerNullable: boolean;
      candidates?: string[];
    }
  | { kind: 'expr'; expr: string };

export interface DescribeResult {
  fields: ResultField[];
  provenance: Provenance[] | null;
  /** Base tables in scope, for matching comment overrides and bare columns by name. */
  relations: string[];
}

/**
 * Per-query escape hatches parsed from leading comments: `@notNull`/`@nullable` set a
 * column's nullability; `@type <col> <TsType>` sets its full TS type verbatim — the
 * only way to type an expression column (a `json_agg(...)`, `paradedb.score(...)`, …)
 * that has no base column to carry a `COMMENT ON COLUMN`.
 */
export interface Overrides {
  notNull: Set<string>;
  nullable: Set<string>;
  types: Map<string, string>;
}

/** table -> column -> raw Postgres `COMMENT ON COLUMN` text. */
export type RawColumnComments = Record<string, Record<string, string>>;

/** Schema-level overrides parsed from a column's comment markers. */
export interface ColumnOverride {
  notNull?: boolean;
  nullable?: boolean;
  tsType?: string;
  /** The comment's prose (markers stripped), emitted as the field's JSDoc. */
  doc?: string;
}

/** table -> column -> its parsed comment overrides. */
export type ColumnOverrides = Record<string, Record<string, ColumnOverride>>;

export type NullabilityReason =
  | 'override'
  | 'comment'
  | 'outer-join'
  | 'catalog'
  | 'unresolved'
  | 'expr';

export interface ResolvedField {
  name: string;
  ts: string;
  nullable: boolean;
  reason: NullabilityReason;
  note?: string;
  /** The source column's comment prose, emitted as the field's JSDoc. */
  doc?: string;
}

export interface DiscoveredQuery {
  name: string;
  sql: string;
  paramCount: number;
  neutralized: boolean;
  line: number;
}

export interface EmitModel {
  name: string;
  resultFields: ResolvedField[];
}

// The user-facing `sqlgen.config.ts` contract (`SqlgenConfig`, `defineConfig`) lives in
// the published package's `@ilbertt/bun-sqlgen/config` submodule, not here — it must
// compile to a declaration free of this private package. Core only consumes the
// resolved introspection settings, modelled by `IntrospectorOptions` below.

/** Which engine introspects the migrations at build time. Defaults to `postgres`. */
export type Dialect = 'postgres' | 'sqlite';

/** In-process build-time DB with migrations applied — the dialect-agnostic seam. */
export interface Introspector {
  /** Resolve a query's result columns (name + TS type), provenance, and relations. */
  describe: (sql: string) => Promise<DescribeResult>;
  /** Per-column `NOT NULL`, for nullability resolution. */
  catalog: () => Promise<Catalog>;
  /** Per-column documentation/override comments (empty for engines without them). */
  columnComments: () => Promise<RawColumnComments>;
  /** Writable columns (not identity/generated), for SET-clause neutralization. */
  writableColumns: () => Promise<WritableColumns>;
  close: () => Promise<void>;
}

export interface IntrospectorOptions {
  dialect: Dialect;
  migrationsDir: string;
  prelude?: string;
  transformMigration?: (input: { sql: string; filename: string }) => string;
  /** Postgres only: PGlite extensions to load before migrations. */
  extensions?: () => Extensions | Promise<Extensions>;
}
