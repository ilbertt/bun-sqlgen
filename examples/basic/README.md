# basic

A minimal example using [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md)
to generate a typed result interface for a `Bun.sql` query: one migration, one file,
one query. The query is a `sql.GetUser` tag on a `withTypes`-wrapped client; its fields
are accessed inline so the inferred types are visible — `bigint` → `string`, `integer`
→ `number`, `boolean`, `timestamptz` → `Date`, and `| null` only where the schema has
no `NOT NULL` — and two `@ts-expect-error`s show misuse is caught. The generated
`queries.gen.ts` is committed so `tsc` passes without a DB.

Codegen runs with `--package @repo/bun-sqlgen` so the `declare module` targets the
workspace name the example imports from (real projects use the default
`@ilbertt/bun-sqlgen`).

Editing the query and running `codegen` is all it takes; misusing the result type
(`row.whatever`, `row.display_name.length` on a nullable column) becomes a `tsc`
error, and a query with invalid SQL fails `codegen` with the real Postgres message.

Everything else — joins and nullability, views, fragments, column comments, the
schema block — lives in the [`advanced`](../advanced) example, one feature per file.
