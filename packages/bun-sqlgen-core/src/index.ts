/** biome-ignore-all lint/performance/noBarrelFile: index is the only file allowed to re-export */

export type {
  GenerateFailure,
  GenerateOptions,
  GenerateResult,
  MigrationOrderCheck,
} from '#generate.ts';
export { generate } from '#generate.ts';
export { oidToTs, PG_OID } from '#oids.ts';
export type {
  Catalog,
  ColumnForeignKey,
  DescribeResult,
  Dialect,
  DiscoveredQuery,
  NullabilityReason,
  Overrides,
  Provenance,
  ResolvedField,
  ResultField,
  SchemaColumn,
  SchemaTable,
  TypeCatalog,
  TypeInfo,
  WritableColumns,
} from '#types.ts';
