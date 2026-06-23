# bun-sqlgen

> Type-safe SQL for Bun, no ORM — raw [`Bun.sql`](https://bun.sh/docs/runtime/sql),
> live-checked against your schema.

Tag a query with a name — `` sql.GetUser`...` `` — and its fully-typed, null-safe
row appears right at the call site: no ORM, no generics, no hand-written types.
Codegen plans every query against a real Postgres or SQLite database (no Docker
needed), so wrong columns and bad SQL fail the build, not production — fast enough
to rerun on every save. The runtime stays 100% Bun-native.

Published as **[`@ilbertt/bun-sqlgen`](https://www.npmjs.com/package/@ilbertt/bun-sqlgen)** —
its [README](./packages/bun-sqlgen/pkg/README.md) is the full guide: both dialects,
nullability overrides, transactions, and configuration.

## Install

```sh
bun add @ilbertt/bun-sqlgen
```

## Quick start

1. Migrations are the source of truth for your schema — put them in any folder:

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
     return user; // typed { id: string; email: string; display_name: string | null }
   }
   ```

3. Generate the types:

   ```sh
   bun bun-sqlgen generate 'src/**/*.ts' --migrations db/migrations
   ```

   This writes `src/queries.gen.d.ts` — commit it. With it in place, `user.emial` is
   a compile error and `user.display_name.length` is flagged as possibly-null, all by
   plain `tsc`.

## Examples

Runnable projects live in the [`examples/`](./examples) folder.

## Contributing

Development setup and conventions are in [CONTRIBUTING.md](./.github/CONTRIBUTING.md).
