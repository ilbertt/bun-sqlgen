# sqlite

A minimal **SQLite** example using
[`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md) to generate typed
result interfaces. Same as the [`simple`](../simple) example, but the client is
`new SQL('sqlite://:memory:')` and codegen introspects with `--dialect sqlite` (via
`bun:sqlite`). The inline comments call out SQLite-specific behavior — `BOOLEAN` /
`BIGINT` → `number`, `DATETIME` → `string`, and the conservative outer-join
nullability that `@notNull` recovers. The generated `queries.gen.d.ts` is committed
so `tsc` passes without a DB.

## What SQLite trades off vs Postgres

The query and runtime side are identical — only the build-time introspection
engine differs (`bun:sqlite` instead of PGlite). SQLite exposes less metadata, so:

- a query with an **outer join** marks every column nullable (no column-origin
  info); use a per-query `@notNull` to recover a known-present column;
- **expression** columns (function calls, arithmetic) usually type as `unknown`,
  since SQLite can't describe a result type without executing;
- **column comments** don't exist, so the schema-level `@type`/`@notNull` overrides
  are Postgres-only here.
