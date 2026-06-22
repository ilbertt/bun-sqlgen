# sqlite

A minimal **SQLite** example that uses
[`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md) to generate typed
result interfaces for `Bun.sql` queries. Same setup as the [`simple`](../simple)
example, but introspected with `--dialect sqlite`.

- `src/db/migrations/*.sql` — the SQLite schema (source of truth for `NOT NULL`).
- `src/index.ts` — the queries, written as `sql.Name\`...\`` tags on a
  `withTypes`-wrapped `new SQL('sqlite://:memory:')` client. The inline comments
  call out SQLite-specific behavior: `BOOLEAN`/`BIGINT` → `number`, `DATETIME` →
  `string`, the conservative outer-join nullability, and `@notNull` to recover it.
- `src/queries.gen.d.ts` — generated; committed so `tsc` passes without a DB.

## Scripts

```sh
bun run codegen        # regenerate queries.gen.d.ts (introspects via bun:sqlite)
bun run codegen:check  # CI: fail if the generated types are stale
bun run check:types    # tsc against the committed generated types
```

## What SQLite trades off vs Postgres

The query and runtime side are identical — only the build-time introspection
engine differs (`bun:sqlite` instead of PGlite). SQLite exposes less metadata, so:

- a query with an **outer join** marks every column nullable (no column-origin
  info); use a per-query `@notNull` to recover a known-present column;
- **expression** columns (function calls, arithmetic) usually type as `unknown`,
  since SQLite can't describe a result type without executing;
- **column comments** don't exist, so the schema-level `@type`/`@notNull` overrides
  are Postgres-only here.
