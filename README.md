# bun-sqlgen

> Typed results for raw [`Bun.sql`](https://bun.sh/docs/runtime/sql) queries, checked
> against your real schema at build time.

You write SQL in `Bun.sql` tagged templates, each tagged with a name. A codegen step
builds your schema in-process from your migrations — real Postgres via
[PGlite](https://pglite.dev/) or SQLite, no Docker and no running server — plans every
query against it, and emits the result types as a `.d.ts`. A query that drifts from the
schema (a missing column, a bad cast) fails codegen; a mismatched field or null-unsafe
access fails `tsc`.

No ORM and no hand-written row types. `withTypes` is a pass-through over Bun's native
client, so binding, fragments, and prepared-statement caching all stay native, and the
generated `.d.ts` adds nothing at runtime.

## Install

```sh
bun add @ilbertt/bun-sqlgen
```

## Quick start

1. Your migrations are the source of truth for the schema — put them in any folder:

   ```sql
   -- db/migrations/0001_init.sql
   CREATE TABLE users (
     id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     email        text NOT NULL,
     display_name text
   );
   ```

2. Wrap your client with `withTypes` and tag each query with its name:

   ```ts
   import { withTypes } from '@ilbertt/bun-sqlgen';
   import { SQL } from 'bun';

   const sql = withTypes(new SQL(Bun.env.DATABASE_URL!));

   export async function getUser(id: number) {
     const [user] = await sql.GetUser`
       SELECT id, email, display_name FROM users WHERE id = ${id}
     `;
     return user; // { id: string; email: string; display_name: string | null }
   }
   ```

3. Generate the types:

   ```sh
   bun bun-sqlgen generate 'src/**/*.ts' --migrations db/migrations
   ```

   This writes `src/queries.gen.d.ts` — commit it. With it in place, `user.emial` is
   a compile error and `user.display_name.length` is flagged as possibly-null, all by
   plain `tsc`.

## More

The published package is
**[`@ilbertt/bun-sqlgen`](https://www.npmjs.com/package/@ilbertt/bun-sqlgen)**; its
[README](./packages/bun-sqlgen/pkg/README.md) is the full guide:

- **Postgres and SQLite** — the same query API; `--dialect` picks the engine.
- **CI without codegen** — `--check` fails the build on a query that drifted from the
  schema, or on a stale generated file.
- **Nullability inference with escape hatches** — outer joins widen columns to
  nullable; `@notNull` / `@nullable` / `@type` pragmas override it per query or via
  column comments.
- **Typed inside transactions** — the client passed to `begin` / `savepoint` is typed
  and discovered by codegen too.

## Examples

Runnable projects live in the [`examples/`](./examples) folder.

## Contributing

Development setup and conventions are in [CONTRIBUTING.md](./.github/CONTRIBUTING.md).
