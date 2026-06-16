# @repo/bun-sqlgen-core

Internal library powering [`@ilbertt/bun-sqlgen`](../bun-sqlgen/pkg/README.md). It
holds the actual generator and is **never published** — the CLI package bundles it
into its binary (see [`../bun-sqlgen`](../bun-sqlgen)). It has no build step; it's
consumed as source via its `exports`.

## Pipeline

```
discover sql<Row[]> tags (TS AST)
  → describe against PGlite (validity, OIDs, EXPLAIN provenance)
  → resolve nullability (catalog + outer-join widening + overrides)
  → emit <file>.gen.d.ts
```

PGlite and TypeScript are runtime dependencies (the generator boots a DB and walks
the TS AST). The CLI re-declares them so the published package installs them.
