# @ilbertt/bun-sqlgen

> sqlx-style typed SQL for `Bun.sql` — write raw SQL, get checked result types.

Write raw SQL in `Bun.sql` tagged templates. A codegen step validates each query
against a real (in-process) Postgres at build time and emits the result types, so
plain `tsc` flags wrong property access, null-unsafety, and bad shapes.

Name a query by the **property** you tag it with — `sql.GetUser\`...\`` — and its
row type is inferred at the call site, no manual generic:

```
sql.GetUser`...`  ──▶  describe against PGlite  ──▶  emit queries.gen.d.ts
  (your code)          (catches bad SQL here)        (augments the registry)
       └──────────────── tsc infers the row type from `.GetUser` ───────────────┘
```

`withTypes` ships in this package; the generated file is pure types that augment
its `QueryResults` registry (the [parsh](https://github.com/ilbertt/parsh) /
TanStack-style `declare module` pattern). `tsc` never parses SQL — the generator
hits the database, `tsc` just consumes the types it writes. Runtime stays 100%
Bun-native: fragments, prepared-statement caching, and injection-safe binding are
all preserved.

> Why a property and not the query text? TypeScript widens tagged-template strings
> to `string`, so it can't read anything out of the template at the type level — but
> a property access it preserves exactly. The name lives where `tsc` can see it.

## Installation

```sh
bun add @ilbertt/bun-sqlgen
```

Install it as a regular dependency: `withTypes` is imported at runtime, and the
`bun-sqlgen` codegen bin lives in the same package. Requires Bun ≥ 1.3. PGlite
(in-process WASM Postgres — no Docker) is pulled in too but is only loaded by the
CLI at generation time — `withTypes` itself has no heavy dependencies.

## Quick start

1. **Migrations are the source of truth for your schema** (this is where
   `NOT NULL` lives). Put them in `migrations/*.sql`:

   ```sql
   -- migrations/0001_init.sql
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
   bunx bun-sqlgen generate 'src/**/*.ts' --migrations migrations
   ```

   This writes `src/queries.gen.d.ts` — the result interfaces plus a `declare
   module` block that augments the registry. No runtime; nothing to import (the
   `.d.ts` is ambient, so the augmentation applies on its own):

   ```ts
   export interface IGetUserResult {
     id: string; // int8 reads back as string under Bun.sql
     email: string;
     display_name: string | null;
   }
   declare module '@ilbertt/bun-sqlgen' {
     interface QueryResults { GetUser: IGetUserResult }
   }
   ```

Now `user.emial` is a compile error and `user.display_name.length` is flagged as
possibly-null — all by plain `tsc`.

The untyped `sql\`...\`` escape hatch and real methods (`sql.begin`, …) keep
working on the wrapped client. The result interfaces are exported too, so you can
import `IGetUserResult` directly if you need to name the row type elsewhere.

## CLI

```sh
bunx bun-sqlgen generate <glob> --migrations <dir> [--out <file>] [--package <name>] [--config <file>] [--check | --check-queries | --check-stale]
```

| argument | meaning |
|---|---|
| `<glob>` | glob for your query source files, e.g. `'src/**/*.ts'` (quote it so the shell doesn't expand it). |
| `--migrations <dir>` | **required** — your migrations directory. |
| `--out <file>` | output path for the generated module (default `src/queries.gen.d.ts`). |
| `--package <name>` | package whose `QueryResults` registry to augment (default `@ilbertt/bun-sqlgen`) — the specifier you import `withTypes` from. |
| `--config <file>` | explicit path to `sqlgen.config.{ts,js,mjs}`. |
| `--check-queries` | fail (exit 1) if any discovered query doesn't plan against the schema. Writes nothing — a build-time SQL linter that needs no committed output. |
| `--check-stale` | fail (exit 1) if the committed generated module is out of date. Writes nothing — the `sqlx prepare --check` freshness analog. |
| `--check` | run **all** checks (queries + stale types); writes nothing. The one-flag CI default. |

The `--check*` modes never write — wire them into CI or a pre-commit hook. They
nest: `--check` ≡ `--check-queries --check-stale`. Use `--check-stale` (or `--check`)
when you commit `queries.gen.d.ts` and consume the result types; reach for
`--check-queries` alone when you only want the SQL validated and don't keep a
generated file at all.

Paths resolve relative to the current directory. A suggested wiring in
`package.json`:

```json
{
  "scripts": {
    "codegen": "bun-sqlgen generate 'src/**/*.ts' --migrations migrations",
    "codegen:check": "bun-sqlgen generate 'src/**/*.ts' --migrations migrations --check"
  }
}
```

Commit the generated `queries.gen.d.ts` and run `codegen:check` in CI so an edited
query can never type-check against a stale shape.

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

## Naming

A query's name is the **property you tag it with** — `sql.GetUser\`...\`` becomes
`IGetUserResult` and the `GetUser` registry key. Names must be unique across the
whole project (they share one registry).

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

`/* @skip */` opts a query out of generation entirely (for SQL too dynamic to
describe — e.g. `UPDATE ... SET ${dynamic}`, or an expression whose shape you'd
rather type by hand).

### Column types & docs via column comments

A column's TS type is a fact about the **column**, not a query, so it lives on a
`COMMENT ON COLUMN` — never per query. The same comment carries `@notNull` /
`@nullable`, and its **prose becomes the generated field's JSDoc**:

```sql
-- a GENERATED column Postgres reports as nullable, but is always present:
COMMENT ON COLUMN app.users.created_at IS 'Derived from the id. @notNull';
-- shape a jsonb column everywhere it is selected, and document it:
COMMENT ON COLUMN app.users.prefs IS 'User preferences. @type { theme: "light" | "dark" }';
```

```ts
export interface IGetUserResult {
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

- **Dynamic fragments** composed at runtime (`sql\`... ${sql(cols)} ...\``) can't
  be planned statically. The generator neutralizes what it can to keep the row
  shape and notes when it does; verify those, or `@skip` them.
- **PGlite vs real Postgres.** PGlite gives sub-second in-process regen. Its
  `describeQuery` doesn't expose `tableID`/`columnID`, so nullability comes from
  the catalog + `EXPLAIN` provenance rather than the wire protocol.
- **Params aren't type-checked** by Bun's tag (its signature is `...values:
  unknown[]`). The generated result types cover the read side.

## License

[Unlicense](https://unlicense.org/)
