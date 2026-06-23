# @ilbertt/bun-sqlgen

> sqlx-style typed SQL for `Bun.sql` — write raw SQL, get checked result types.

Write raw SQL in `Bun.sql` tagged templates. A codegen step validates each query
against a real in-process database (Postgres or [SQLite](#dialects-postgres-and-sqlite))
at build time — no Docker or running database needed — and emits the result types,
so plain `tsc` flags wrong property access, null-unsafety, and bad shapes.

Name a query by the **property** you tag it with — `` sql.GetUser`...` `` — and its
row type is inferred right at the call site, no manual generic to write. No runtime
overhead: the generated types live in a `.d.ts` that `tsc` erases, and `withTypes`
is a thin pass-through to Bun's native client — fragments, prepared-statement
caching, and injection-safe binding all run natively.

## Installation

```sh
bun add @ilbertt/bun-sqlgen
```

## Quick start

1. **Migrations are the source of truth for your schema** (this is where
   `NOT NULL` lives). Put them in any folder — you point the codegen at it with
   `--migrations`:

   ```sql
   -- db/migrations/0001_init.sql
   CREATE TABLE users (
     id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     email        text NOT NULL,
     display_name text
   );
   ```

2. **Wrap your client** with `withTypes`, then tag each query with its name and
   read it back at the call site:

   ```ts
   // src/queries.ts
   import { withTypes } from '@ilbertt/bun-sqlgen';
   import { SQL } from 'bun';

   const sql = withTypes(new SQL(Bun.env.DATABASE_URL!));

   export async function getUser(id: number) {
     const [user] = await sql.GetUser`
       SELECT id, email, display_name FROM users WHERE id = ${id}
     `;
     return user; // typed { id: string; email: string; display_name: string | null }
   }
   ```

3. **Generate** the types:

   ```sh
   bun bun-sqlgen generate 'src/**/*.ts' --migrations db/migrations
   ```

   This writes `src/queries.gen.d.ts` — commit it alongside your code. With it in
   place, `user.emial` is a compile error and `user.display_name.length` is flagged
   as possibly-null, all by plain `tsc`.

The wrapped client still exposes the untyped `` sql`...` `` escape hatch and every
real method (`sql.begin`, …). To reuse a query's row type elsewhere, import
`QueryResults` and read it by the query's name:

```ts
import type { QueryResults } from '@ilbertt/bun-sqlgen';

type User = QueryResults['GetUser']; // { id: string; email: string; display_name: string | null }
```

### Inside transactions

The client passed to a `begin`/`transaction`/`savepoint` callback is typed too, so a
named query works the same inside a transaction (and gets discovered by the codegen):

```ts
await sql.begin(async (tx) => {
  const [order] = await tx.CreateOrder`INSERT INTO orders ... RETURNING id, total`;
  await tx.savepoint(async (sp) => {
    await sp.MarkPaid`UPDATE orders SET paid = true WHERE id = ${order!.id}`;
  });
  return order; // order.total is typed
});
```

## CLI

```sh
bun bun-sqlgen generate <glob> --migrations <dir> [options]
```

Run `bun bun-sqlgen generate --help` for the full, always-current option list. The
essentials: `<glob>` is your query source files (quote it so the shell doesn't
expand it) and `--migrations` is required. Three check modes write nothing and exit
non-zero on a problem:

- **`--check-queries`** — validate SQL only: plan every named query against the
  schema and fail on any that don't (a missing column, a renamed table, a bad cast).
  No types generated, no Docker, no running database — reach for it even if you only
  want CI to guard that your raw SQL still matches the schema.
- **`--check-stale`** — fail if the committed `queries.gen.d.ts` is out of date.
- **`--check`** — run both; the one-flag CI default.

Commit the generated file and run `--check` in CI so an edited query can never
type-check against a stale shape. The
[`check-only` example](https://github.com/ilbertt/bun-sqlgen/tree/main/examples/check-only)
shows the validate-only lane end to end.

## Dialects: Postgres and SQLite

bun-sqlgen defaults to Postgres but also supports **SQLite**. The query side is
identical — Bun's `SQL` speaks SQLite through its `sqlite://` adapter, so you write
the same `withTypes(new SQL(...))` client and `` sql.Name`...` `` tags:

```ts
const sql = withTypes(new SQL('sqlite://app.db')); // or 'sqlite://:memory:'
```

Select the engine with `--dialect sqlite` (or `dialect: 'sqlite'` in
`sqlgen.config.ts`). Build-time introspection runs against an in-memory
`bun:sqlite` database — built into Bun, nothing extra to install:

```sh
bun bun-sqlgen generate 'src/**/*.ts' --migrations db/migrations --dialect sqlite
```

Result types match what `Bun.SQL` returns at runtime: `INTEGER` / `REAL` /
`NUMERIC` / `BOOLEAN` / `BIGINT` → `number`, `TEXT` → `string`, `BLOB` →
`Uint8Array`, and `DATE` / `DATETIME` / `TIMESTAMP` → `string` (Bun returns the
stored text, not a `Date`).

**SQLite is a weaker introspection target than Postgres** — plan for these gaps:

- **Nullability is more conservative.** Per-column `NOT NULL` still comes from the
  schema, but SQLite exposes no column-origin metadata, so any query containing an
  outer join marks **every** column nullable. Recover precision with per-query
  `@notNull`.
- **Expression columns** (function calls, arithmetic, most aggregates) typically
  type as `unknown`: SQLite can't describe a result type without executing, and the
  build-time database is empty. `count(*)` and similar integer aggregates are typed;
  for the rest, set the type with a per-query `@type <col> <TsType>`.
- **No column comments.** The schema-level overrides via `COMMENT ON COLUMN` are
  Postgres-only; the per-query `@notNull`/`@nullable`/`@type` pragmas work in both
  dialects.

A runnable example lives in the
[`sqlite` example](https://github.com/ilbertt/bun-sqlgen/tree/main/examples/sqlite).

## Configuration

An optional `sqlgen.config.ts` in the current directory shapes the throwaway
introspection database so it matches production. It's a plain module whose
default export is the config object:

```ts
import { citext } from '@electric-sql/pglite/contrib/citext';

export default {
  // PGlite extensions to load so a migration's CREATE EXTENSION can succeed.
  // Bundled contrib extensions live under '@electric-sql/pglite/contrib/*';
  // others ship as their own package (e.g. pgvector as '@electric-sql/pglite-pgvector').
  extensions: () => ({ citext }),
  // SQL run before migrations — stub functions/types the app provides out-of-band.
  prelude: `CREATE FUNCTION app_current_actor() RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT 'system'::text $$;`,
  // rewrite/strip statements PGlite can't run, per migration file (CREATE INDEX
  // CONCURRENTLY can't run inside the transaction a multi-statement file applies in).
  transformMigration: ({ sql }) => sql.replace(/\bCONCURRENTLY\b/g, ''),
};
```

A runnable walkthrough of all three fields lives in the
[`with-config` example](https://github.com/ilbertt/bun-sqlgen/tree/main/examples/with-config).
`extensions` is Postgres-only; `prelude` and `transformMigration` apply to both
dialects, and `dialect: 'sqlite'` selects SQLite (the `--dialect` flag overrides it).

## Naming

A query's name is the **property you tag it with** — `` sql.GetUser`...` `` — and
becomes its `QueryResults['GetUser']` type. Names must be unique across the whole
project.

## Overrides

Nullability is a sound-leaning heuristic: base columns trace through the catalog
and outer-join widening (a `NOT NULL` column pulled through a `LEFT JOIN` becomes
nullable); expressions (functions, `CASE`, casts, aggregates) are conservatively
nullable. Override the nullability of a query's columns with leading-comment
pragmas — the sqlx `col!`/`col?` escape hatch:

```sql
/* @notNull total */
/* @nullable note */
SELECT count(*) AS total, note FROM ...
```

For a column the generator genuinely can't type — an **expression** with no base
column, like a `json_agg(...)` or a `paradedb.score(...)` — give its full TS type
with `@type <col> <TsType>`. Everything after the column name to end-of-line is the
type, verbatim (nullability included), so it wins over the catalog and the heuristic:

```sql
/* @type participants Array<{ id: string; name: string | null }> */
/* @type score number | null */
SELECT
  json_agg(json_build_object('id', p.id, 'name', p.name)) AS participants,
  paradedb.score(id) AS score,
  ...
```

The type lands verbatim in the generated `.d.ts`, which has no imports — so keep it
**self-contained**: use structural types and globals, or an inline `import('...')`
(`@type prefs import('#db/tables').Prefs`) rather than a bare imported name.

To opt a query out of generation entirely — SQL too dynamic to describe, or an
expression whose shape you'd rather type by hand — **drop the `sql.Name` tag** and
use the bare `` sql`...` `` escape hatch with your own row type. A bare tag is never
discovered, so there's nothing to skip: naming a query *is* the opt-in.

### Column types & docs via column comments

When a TS type is a fact about a **base column** (selected across many queries), it
belongs on a `COMMENT ON COLUMN`, not repeated per query — that's the difference from
the per-query `@type` above, which is for expression columns that have no base column
to comment. The same comment carries `@notNull` / `@nullable`, and its **prose becomes
the generated field's JSDoc**:

```sql
-- a GENERATED column Postgres reports as nullable, but is always present:
COMMENT ON COLUMN app.users.created_at IS 'Derived from the id. @notNull';
-- shape a jsonb column everywhere it is selected, and document it:
COMMENT ON COLUMN app.users.prefs IS 'User preferences. @type { theme: "light" | "dark" }';
```

```ts
interface IGetUserResult {
  /** User preferences. */
  prefs: { theme: "light" | "dark" } | null;
}
```

Precedence is **per-query `@notNull`/`@nullable` → column comment → catalog/OID
default**. A column comment sets the column's *base* nullability, so outer-join
widening still applies on top (a `@notNull` column pulled through a `LEFT JOIN` is
still nullable in that query). Only the `@…` tokens are read for behavior; the
rest of the comment is carried through as documentation.

## Boundaries

- **Dynamic fragments** composed at runtime (`` sql`... ${sql(cols)} ...` ``) can't
  be planned statically. The generator neutralizes what it can to keep the row
  shape and notes when it does; verify those, or drop the name to hand-type them.
- **PGlite vs real Postgres.** PGlite gives sub-second in-process regen. Its
  `describeQuery` doesn't expose `tableID`/`columnID`, so nullability comes from
  the catalog + `EXPLAIN` provenance rather than the wire protocol.
- **Params aren't type-checked** by Bun's tag (its signature is `...values:
  unknown[]`). The generated result types cover the read side.
