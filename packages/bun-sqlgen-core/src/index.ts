/** biome-ignore-all lint/performance/noBarrelFile: index is the only file allowed to re-export */

export type {
  GenerateFailure,
  GenerateOptions,
  GenerateResult,
} from '#generate.ts';
export { generate } from '#generate.ts';
export { oidToTs, PG_OID } from '#oids.ts';
export type {
  Catalog,
  DescribeResult,
  Dialect,
  DiscoveredQuery,
  NullabilityReason,
  Overrides,
  PostgresConfig,
  Provenance,
  ResolvedField,
  ResultField,
  SqlgenConfig,
  SqliteConfig,
  TypeCatalog,
  TypeInfo,
  WritableColumns,
} from '#types.ts';
