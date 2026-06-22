# with-config

Shows how a [`sqlgen.config.ts`](./sqlgen.config.ts) shapes the throwaway
introspection DB so migrations that depend on extensions, app-provided functions,
or `CONCURRENTLY` apply the same way they would against production. Builds on the
[`simple`](../simple) example — see it first for the basics of
[`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md).

- `sqlgen.config.ts` — the config. Auto-discovered because codegen runs from this
  directory; each field earns its place:
  - `extensions` — loads the `citext` extension into PGlite so `CREATE EXTENSION
    citext` succeeds (real Postgres has it on disk; PGlite must be handed it).
  - `prelude` — stubs `app_current_actor()`, a function the app supplies at runtime
    and which a column DEFAULTs to, so the table can be created at introspection time.
  - `transformMigration` — strips `CONCURRENTLY`, which can't run inside the
    transaction a multi-statement migration file is applied in.
- `src/db/migrations/*.sql` — the schema, written as it would be for production
  (none of it runs as-is under PGlite without the config above).
- `src/index.ts` — the queries. `slug`/`email` are `citext`, typed `string` by a
  `COMMENT ON COLUMN ... @type` (an extension type is otherwise `unknown`); a
  `LEFT JOIN` widens the NOT NULL author columns to nullable.
- `src/queries.gen.d.ts` — generated and committed, so `tsc` passes without a DB.

Codegen runs with `--package @repo/bun-sqlgen` so the `declare module` targets the
workspace name the example imports from (real projects use the default `@ilbertt/bun-sqlgen`).

## Scripts

```sh
bun run codegen        # regenerate queries.gen.d.ts (auto-discovers sqlgen.config.ts)
bun run codegen:check  # CI: fail if the generated types are stale
bun run check:types    # tsc against the committed generated types
```

Drop the config and `codegen` fails: `CREATE EXTENSION citext` can't find the
extension, `app_current_actor()` doesn't exist, and `CONCURRENTLY` aborts the
transaction — each error pointing at the field that resolves it. Pass an explicit
path with `--config ./sqlgen.config.ts` if it lives outside the codegen directory.
