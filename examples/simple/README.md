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
column and an index name that don't exist. The result interfaces reference that block
rather than repeating types — `ListDealDetails.deal_id` is `IDealsColumns['id']` even
though the query selects it through a view — and `NamedUsers` shows a `@notNull` pragma
narrowing a schema-nullable column to `NonNullable<…>`.

`users` and `deals` both carry a `search_key` `VIRTUAL` generated column commented
`@notNull`, covering [#23](https://github.com/ilbertt/bun-sqlgen/issues/23): a generated
column reaches the plan as its generating expression, so its comment is matched by
relation and name. `UserSearchKeys` (one table), `DealSearchKeys` (a join where both
tables comment the name) and `OptionalSearchKeys` (widened back to nullable by a
`LEFT JOIN`) pin all three outcomes.

Editing a query and running `codegen` is all it takes; misusing a result type
(`row.whatever`, `row.display_name.length` on a nullable column) becomes a `tsc`
error, and a query with invalid SQL fails `codegen` with the real Postgres message.
