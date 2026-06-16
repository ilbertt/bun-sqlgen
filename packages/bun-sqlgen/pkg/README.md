# @ilbertt/bun-sqlgen

> sqlx-style typed SQL for `Bun.sql` — write raw SQL, get checked result types.

Write raw SQL in `Bun.sql` tagged templates. A codegen step validates each query
against a real (in-process) Postgres at build time and emits the result types, so
plain `tsc` flags wrong property access, null-unsafety, and bad shapes.

Name a query by the **property** you tag it with — `sql.GetUser\`...\`` — and its
row type is inferred at the call site, no manual generic:

```
sql.GetUser`...`  ──▶  describe against PGlite  ──▶  emit queries.gen.ts
  (your code)          (catches bad SQL here)        (registry + withTypes wrapper)
       └──────────────── tsc infers the row type from `.GetUser` ───────────────┘
```

`tsc` never parses SQL. The generator hits the database; `tsc` just consumes the
types it writes. Runtime stays 100% Bun-native — fragments, prepared-statement
caching, and injection-safe binding are all preserved; the generator only reads
your code and writes one aggregated type module.

> Why a property and not the query text? TypeScript widens tagged-template strings
> to `string`, so it can't read a `@name` comment out of the template at the type
> level — but a property access it preserves exactly. The name lives where `tsc`
> can actually see it.

## Installation

```sh
bun add -d @ilbertt/bun-sqlgen
```

Requires Bun ≥ 1.3. PGlite (in-process WASM Postgres — no Docker) is pulled in as
a dependency and used only at generation time.

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

2. **Wrap your client** with `withTypes` (imported from the not-yet-generated
   module), then tag each query with its name and read it back at the call site:

   ```ts
   // src/queries.ts
   import { SQL } from 'bun';
   import { withTypes } from './queries.gen';

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

   This writes one aggregated `src/queries.gen.ts` — the result interfaces, a
   name→row registry, and the `withTypes` wrapper:

   ```ts
   export interface IGetUserResult {
     id: string; // int8 reads back as string under Bun.sql
     email: string;
     display_name: string | null;
   }
   export interface QueryResults {
     GetUser: IGetUserResult;
   }
   export type TypedSQL = SQL & { readonly [K in keyof QueryResults]: ... };
   export function withTypes(sql: SQL): TypedSQL { /* Proxy */ }
   ```

Now `user.emial` is a compile error and `user.display_name.length` is flagged as
possibly-null — all by plain `tsc`.

The untyped `sql\`...\`` escape hatch and real methods (`sql.begin`, …) keep
working on the wrapped client. The interfaces are also exported, so the explicit
`sql<IGetUserResult[]>\`/* @name GetUser */ ...\`` form still works if you prefer it.

> First run: the generated module doesn't exist yet, so the import is unresolved
> until the first `generate` writes it — exactly like importing a not-yet-generated
> type. Commit `queries.gen.ts` and it's resolved from then on.

## CLI

```sh
bunx bun-sqlgen generate <glob> --migrations <dir> [--out <file>] [--config <file>] [--check]
```

| argument | meaning |
|---|---|
| `<glob>` | glob for your query source files, e.g. `'src/**/*.ts'` (quote it so the shell doesn't expand it). |
| `--migrations <dir>` | **required** — your migrations directory. |
| `--out <file>` | output path for the generated module (default `src/queries.gen.ts`). Point your `withTypes` import at it. |
| `--config <file>` | explicit path to `sqlgen.config.{ts,js,mjs}`. |
| `--check` | fail (exit 1) if anything would change — the `sqlx prepare --check` analog for CI. |

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

Commit the generated `queries.gen.ts` and run `codegen:check` in CI so an edited
query can never type-check against a stale shape.

## Configuration

An optional `sqlgen.config.ts` in the current directory shapes the throwaway
introspection database so it matches production. It's a plain module whose
default export is the config object:

```ts
import { vector } from '@electric-sql/pglite/vector';

export default {
  // PGlite extensions to load before applying migrations
  extensions: () => ({ vector }),
  // SQL run before migrations (CREATE EXTENSION, stub functions/types)
  prelude: 'CREATE EXTENSION IF NOT EXISTS vector;',
  // rewrite/strip statements PGlite can't run, per migration file
  transformMigration: ({ sql }) => sql.replace(/CONCURRENTLY/g, ''),
};
```

## Naming

A query's name is the **property you tag it with** — `sql.GetUser\`...\`` becomes
`IGetUserResult` and the `GetUser` registry key. Names must be unique across the
whole project (they share one module). Using the explicit-generic escape hatch
instead? Name it with a `/* @name Foo */` comment (before the tag or inside the
SQL); an unnamed one falls back to `IUnnamedQueryNResult` as a nudge to name it.

## Overrides

Nullability is a sound-leaning heuristic: base columns trace through the catalog
and outer-join widening (a `NOT NULL` column pulled through a `LEFT JOIN` becomes
nullable); expressions (functions, `CASE`, casts, aggregates) are conservatively
nullable. Override per query with leading-comment pragmas — the sqlx `col!`/`col?`
escape hatch:

```sql
/* @name report */
/* @notNull total */
/* @nullable note */
/* @type details { priority: number; notes: string } */
SELECT count(*) AS total, note, details FROM ...
```

`/* @skip */` opts a query out of generation entirely (for SQL too dynamic to
describe — e.g. `UPDATE ... SET ${dynamic}` — which you type by hand).

### Schema-level overrides via column comments

When an override is a fact about the **column** rather than one query, declare it
once in the schema with `COMMENT ON COLUMN` and the same `@notNull` / `@nullable`
/ `@type` markers. It then applies to every query that selects that column —
no per-query annotation:

```sql
-- a GENERATED column Postgres reports as nullable, but is always present:
COMMENT ON COLUMN app.users.created_at IS 'Derived from the id. @notNull';
-- give a jsonb column a precise shape everywhere it is selected:
COMMENT ON COLUMN app.users.prefs IS '@type { theme: "light" | "dark" }';
```

Precedence is **per-query pragma → column comment → catalog/OID default**. A
column comment sets the column's *base* nullability, so outer-join widening still
applies on top (a `@notNull` column pulled through a `LEFT JOIN` is still nullable
in that query). Prose and markers can share a comment — only the `@…` tokens are
read, so the comment stays useful as documentation.

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
