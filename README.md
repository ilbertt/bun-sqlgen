# bun-sqlgen

> Types generator for your [`Bun.sql`](https://bun.sh/docs/runtime/sql) queries

You don't need an ORM to have type-safe SQL statements in your Bun application.
[`@ilbertt/bun-sqlgen`](https://www.npmjs.com/package/@ilbertt/bun-sqlgen) is a codegen tool that validates your queries against your schema and generates their result types.
No running database is needed at codegen time, because your migrations run against an in-memory Wasm Postgres ([PGlite](https://pglite.dev/)).

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

   This writes `src/queries.gen.d.ts` — commit it. With it in place, `user.whatever` is
   a compile error and `user.display_name.length` is flagged as possibly-null, all by
   plain `tsc`.

## Examples

Runnable projects live in the [`examples/`](./examples) folder.

## Contributing

Development setup and conventions are in [CONTRIBUTING.md](./.github/CONTRIBUTING.md).
