/** biome-ignore-all lint/performance/noBarrelFile: index is the only file allowed to re-export */
// Public library entry (the package `.` export): the `withTypes` runtime and the
// `QueryResults` registry that generated `*.gen.d.ts` files augment. Relative
// re-exports keep the emitted, published `index.d.ts` resolvable for consumers.
export type { QueryResults, TypedSQL } from './lib/registry.ts';
export { withTypes } from './lib/with-types.ts';
