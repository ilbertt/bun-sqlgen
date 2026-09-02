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

The names go out as the `schema` const, and each table interface's `relationType` /
`indexes` / `constraints` members are *derived* from it
(`keyof (typeof schema)['users']['_indexes']`) rather than declared again, so the values
and the types cannot drift. An empty node map gives `never`.

The nullability step already resolves each result field to its base column (that's how
it finds the catalog entry), so it keeps that `source` on the `ResolvedField` and the
emitter turns it into a reference — `IUsersColumns['email']` instead of a repeated
`string`. Only when both agree on the type; a per-query `@type` deliberately leaves
`source` unset. Nullability is composed on top per query (`| null` for outer-join
widening, `NonNullable<…>` for a `@notNull` pragma), because it isn't a property of
the column alone.

The describe step runs against a dialect-specific introspector under `introspect/`,
chosen by `dialect` (default `postgres`): **PGlite** for Postgres (`describeQuery`
OIDs + `EXPLAIN VERBOSE` provenance) or **`bun:sqlite`** for SQLite (prepared-statement
`declaredTypes`/`columnTypes` + the shared FROM/JOIN scan in `introspect/sql-text.ts`).
Both satisfy one `Introspector` interface and resolve each field's TS type internally,
so the nullability/emit stages stay engine-agnostic.

**Views** are the one thing provenance can't see: Postgres expands a view before
planning, so the plan reports the base tables and a comment on the view's own column
would never be read. `DescribeResult.views` therefore comes from scanning the query
text — the only place the view is still named — and `Introspector.viewColumns()`
describes each view's `SELECT *` to learn which base column each of its columns passes
through. A field then matches a view column by that base column (so an aliased
`SELECT amount AS a` still finds it) or, for a computed one, by name. A materialized
view needs none of this: it's a real relation, and the plan names it.

TypeScript and PGlite are runtime dependencies (the generator walks the TS AST and
boots a Postgres); the SQLite engine is `bun:sqlite`, built into Bun. The CLI
re-declares them so the published package installs them.
