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
  oid: number;
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
  params: number[];
  fields: ResultField[];
  provenance: Provenance[] | null;
  /** Base tables in scope (from the plan), for matching comment overrides by name. */
  relations: string[];
}

/** Per-query escape hatches parsed from leading comments (`@notNull`/`@nullable`/`@type`). */
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
}

export interface DiscoveredQuery {
  name: string;
  explicit: boolean;
  sql: string;
  paramCount: number;
  neutralized: boolean;
  skip: boolean;
  line: number;
}

export interface EmitModel {
  name: string;
  explicit: boolean;
  resultFields: ResolvedField[];
  neutralized: boolean;
}

/** `sqlgen.config.ts` — shapes the throwaway introspection DB to match production. */
export interface SqlgenConfig {
  /** PGlite extensions to load before applying migrations. */
  extensions?: () => Extensions | Promise<Extensions>;
  /** SQL run before migrations (`CREATE EXTENSION`, stub functions/types). */
  prelude?: string;
  /** Rewrite or strip statements PGlite can't run, per migration file. */
  transformMigration?: (input: { sql: string; filename: string }) => string;
}
