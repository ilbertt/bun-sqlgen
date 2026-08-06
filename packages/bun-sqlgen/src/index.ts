/** biome-ignore-all lint/performance/noBarrelFile: index is the only file allowed to re-export */

export type { DatabaseTables, QueryResults, TypedSQL, TypedTransactionSQL } from './lib/registry';
export { withTypes } from './lib/with-types';
