# simple

A minimal example that uses [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md)
to generate typed result interfaces for `Bun.sql` queries.

- `src/db/migrations/*.sql` — the schema (source of truth for `NOT NULL`), passed via `--migrations`.
- `src/queries.ts` — the queries, written as `sql.Name\`...\`` named tags on a `withTypes`-wrapped client (plus one `sql<Row[]>` to show the escape hatch). `withTypes` is imported from `@repo/bun-sqlgen` (the published `@ilbertt/bun-sqlgen`).
- `src/queries.gen.d.ts` — generated; the result interfaces and a `declare module` block that augments the registry. Committed so `tsc` passes without a DB.
- `src/index.ts` — uses a generated type to show `tsc` enforces it.

Codegen runs with `--package @repo/bun-sqlgen` so the `declare module` targets the
workspace name the example imports from (real projects use the default `@ilbertt/bun-sqlgen`).

## Scripts

```sh
bun run codegen        # regenerate queries.gen.d.ts from queries.ts
bun run codegen:check  # CI: fail if the generated types are stale
bun run check:types    # tsc against the committed generated types
```

Editing a query and running `codegen` is all it takes; misusing a result type
(`user.emial`, `user.display_name.length` on a nullable column) becomes a `tsc`
error, and a query with invalid SQL fails `codegen` with the real Postgres message.
