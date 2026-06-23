# with-config

Shows how a [`sqlgen.config.ts`](./sqlgen.config.ts) shapes the throwaway
introspection DB so migrations that depend on extensions, app-provided functions,
or `CONCURRENTLY` apply the same way they would against production. Builds on the
[`simple`](../simple) example — see it first for the basics of
[`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md).

The config is auto-discovered because codegen runs from this directory; each field
earns its place:

- `extensions` — loads the `citext` extension into PGlite so `CREATE EXTENSION
  citext` succeeds (real Postgres has it on disk; PGlite must be handed it).
- `prelude` — stubs `app_current_actor()`, a function the app supplies at runtime
  and which a column DEFAULTs to, so the table can be created at introspection time.
- `transformMigration` — strips `CONCURRENTLY`, which can't run inside the
  transaction a multi-statement migration file is applied in.

The migrations are written as they would be for production (none of it runs as-is
under PGlite without the config above); `slug`/`email` are `citext`, typed `string`
by a `COMMENT ON COLUMN ... @type` (an extension type is otherwise `unknown`), and a
`LEFT JOIN` widens the NOT NULL author columns to nullable. Codegen runs with
`--package @repo/bun-sqlgen` so the `declare module` targets the workspace name the
example imports from (real projects use the default `@ilbertt/bun-sqlgen`).

Drop the config and `codegen` fails: `CREATE EXTENSION citext` can't find the
extension, `app_current_actor()` doesn't exist, and `CONCURRENTLY` aborts the
transaction — each error pointing at the field that resolves it. Pass an explicit
path with `--config ./sqlgen.config.ts` if it lives outside the codegen directory.
