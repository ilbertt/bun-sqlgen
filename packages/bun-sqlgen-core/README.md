# @repo/bun-sqlgen-core

Internal library powering [`@ilbertt/bun-sqlgen`](../bun-sqlgen/pkg/README.md). It
holds the actual generator and is **never published** — the CLI package bundles it
into its binary (see [`../bun-sqlgen`](../bun-sqlgen)). It has no build step; it's
consumed as source via its `exports`.

## Pipeline

```
discover sql.Name`...` tags (TS AST)
  → describe against the dialect's engine (validity, result types, provenance)
  → resolve nullability (catalog + outer-join widening + overrides)
  → emit queries.gen.ts
```

The same generated module carries a **schema block**: `Introspector.tables()` reports
every relation with its columns, index names and constraint names, and those columns
go through the same override resolution the result fields do — so a `COMMENT ON COLUMN`
`@type` shapes a column identically in both. It's on unless `schema: false` is passed.

The describe step runs against a dialect-specific introspector under `introspect/`,
chosen by `dialect` (default `postgres`): **PGlite** for Postgres (`describeQuery`
OIDs + `EXPLAIN VERBOSE` provenance) or **`bun:sqlite`** for SQLite (prepared-statement
`declaredTypes`/`columnTypes` + a FROM/JOIN scan). Both satisfy one `Introspector`
interface and resolve each field's TS type internally, so the nullability/emit stages
stay engine-agnostic.

TypeScript and PGlite are runtime dependencies (the generator walks the TS AST and
boots a Postgres); the SQLite engine is `bun:sqlite`, built into Bun. The CLI
re-declares them so the published package installs them.
