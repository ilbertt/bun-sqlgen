# advanced

Every feature of [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md)
beyond the basics, one per file. Start with the [`basic`](../basic) example for
the shape of a typed query; this one builds on the same conventions — queries are
`sql.Name` tags on the `withTypes`-wrapped client in `client.ts`, their fields are
accessed inline so the inferred types are visible, and `@ts-expect-error` marks what
the types reject. `index.ts` imports each file so `bun build`/`bun run` cover them
all, and the generated `queries.gen.ts` is committed so `tsc` passes without a DB.

| File | Shows |
| --- | --- |
| [`nullability.ts`](./src/nullability.ts) | Outer-join widening, NOT NULL tracing, CTEs, and why expressions/aggregates are nullable |
| [`fragments.ts`](./src/fragments.ts) | Composed `` sql`…` `` fragments (nested too) and the `sql('ident')` escape, resolved statically |
| [`column-types.ts`](./src/column-types.ts) | Enums → literal unions, arrays, and a jsonb column shaped by its `COMMENT ON COLUMN … @type` |
| [`pragmas.ts`](./src/pragmas.ts) | The per-query `/* @notNull col */` override |
| [`generated-columns.ts`](./src/generated-columns.ts) | `GENERATED ALWAYS AS … VIRTUAL` columns, typed by their comment's `@notNull` ([#23](https://github.com/ilbertt/bun-sqlgen/issues/23)) |
| [`views.ts`](./src/views.ts) | A view's own column comments, how they layer over the base column's, and what a view inherits |
| [`schema-types.ts`](./src/schema-types.ts) | `DatabaseTables`: row types, index and constraint names as literal unions |
| [`schema-values.ts`](./src/schema-values.ts) | The runtime `schema` object, and an identifier from it going straight into a query |
| [`foreign-keys.ts`](./src/foreign-keys.ts) | Following `_foreignKeys` from a column, including a composite key |

The migrations under `src/db/migrations` are split the same way: each one introduces
the schema a file above depends on, and its comments say what it's there to show.

Codegen runs with `--package @repo/bun-sqlgen` so the `declare module` targets the
workspace name the example imports from (real projects use the default
`@ilbertt/bun-sqlgen`).
