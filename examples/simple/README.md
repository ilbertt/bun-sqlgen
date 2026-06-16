# simple

A minimal example that uses [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md)
to generate typed result interfaces for `Bun.sql` queries.

- `src/db/migrations/*.sql` — the schema (source of truth for `NOT NULL`), passed via `--migrations`.
- `src/queries.ts` — the queries, written as `sql<Row[]>` tagged templates.
- `src/queries.gen.d.ts` — generated; committed so `tsc` passes without a DB.
- `src/index.ts` — uses a generated type to show `tsc` enforces it.

## Scripts

```sh
bun run codegen        # regenerate queries.gen.d.ts from queries.ts
bun run codegen:check  # CI: fail if the generated types are stale
bun run check:types    # tsc against the committed generated types
bun run start          # run the type-level demo (no database needed)
```

Editing a query and running `codegen` is all it takes; misusing a result type
(`row.emial`, `row.display_name.length` on a nullable column) becomes a `tsc`
error, and a query with invalid SQL fails `codegen` with the real Postgres message.
