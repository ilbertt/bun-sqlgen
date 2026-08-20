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
 * A foreign key as it applies to one of its columns. A composite key appears once on
 * each column it spans, paired with the column that column points at.
 */
export interface ColumnForeignKey {
  /** The constraint's name — the identifier `DROP CONSTRAINT` takes. */
  name: string;
  references: { table: string; column: string };
}

/** A base relation's column as the introspector reports it, before overrides. */
export interface SchemaColumn extends ResultField {
  notNull: boolean;
  foreignKeys: ColumnForeignKey[];
}

/** What a relation is. Postgres partitioned tables report as `table`; SQLite has no matviews. */
export type RelationKind = 'table' | 'view' | 'materialized_view';

/**
 * A base relation — table or view — with its columns and the names of its indexes
 * and constraints. Generic over the column shape: the introspector fills it with
 * `SchemaColumn`s, the emitter with the same `ResolvedField`s the queries use.
 */
export interface Table<Column> {
  name: string;
  kind: RelationKind;
  columns: Column[];
  indexes: string[];
  constraints: string[];
}

export type SchemaTable = Table<SchemaColumn>;

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
  | {
      kind: 'expr';
      expr: string;
      /**
       * The single relation the expression's inputs belong to, when they agree on one.
       * A generated column reaches the plan as its generating expression, so this is
       * the only thing tying it back to the table whose comment documents it.
       */
      relation?: string;
      outerNullable: boolean;
    };

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

/** The base column a result field traces back to. */
export interface ColumnSource {
  table: string;
  column: string;
}

export interface ResolvedField {
  name: string;
  ts: string;
  nullable: boolean;
  reason: NullabilityReason;
  note?: string;
  /** The source column's comment prose, emitted as the field's JSDoc. */
  doc?: string;
  /**
   * Set when the field traces to a base column and takes that column's type — the
   * emitter points at the schema block instead of repeating the type. Left unset by a
   * per-query `@type`, whose whole point is to override what the column says.
   */
  source?: ColumnSource;
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

/** A resolved column plus the schema facts the emitter reports alongside its type. */
export interface EmitColumn extends ResolvedField {
  foreignKeys: ColumnForeignKey[];
}

export type EmitTable = Table<EmitColumn>;

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
  /** Every base relation with its columns, index names and constraint names. */
  tables: () => Promise<SchemaTable[]>;
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
