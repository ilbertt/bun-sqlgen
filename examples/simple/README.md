# simple

A minimal example using [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md)
to generate typed result interfaces for `Bun.sql` queries. The queries are named
`sql.Name` tags on a `withTypes`-wrapped client; their fields are accessed inline so
the inferred types are visible, and a `@ts-expect-error` shows misuse is caught. The
generated `queries.gen.ts` is committed so `tsc` passes without a DB.

Codegen runs with `--package @repo/bun-sqlgen` so the `declare module` targets the
workspace name the example imports from (real projects use the default
`@ilbertt/bun-sqlgen`).

The tail of `src/index.ts` uses the schema block the same file carries: `DatabaseTables`
types a `deals` row and pins the index/constraint names, with `@ts-expect-error` on a
column and an index name that don't exist.

Editing a query and running `codegen` is all it takes; misusing a result type
(`row.whatever`, `row.display_name.length` on a nullable column) becomes a `tsc`
error, and a query with invalid SQL fails `codegen` with the real Postgres message.
