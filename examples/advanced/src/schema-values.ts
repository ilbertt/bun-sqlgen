import type { DatabaseTables } from '@repo/bun-sqlgen';
import { sql } from '#client.ts';
import { schema } from '#queries.gen.ts';

// The schema lands as values too, so an identifier is reachable at runtime and still
// checked: every node carries its own name, and a name that doesn't exist won't compile.
console.log(schema.users._relationName); // 'users'
console.log(schema.users._columns.display_name._columnName); // 'display_name'
console.log(schema.deal_meta._constraints.deal_meta_pkey._constraintName); // 'deal_meta_pkey'

// @ts-expect-error — `users` has no `title` column
console.log(schema.users._columns.title);

// Reaching an identifier is the point: it can go straight into the SQL.
const byKey = await sql.UserByKey`
  SELECT id, email FROM users WHERE ${sql(schema.users._columns.search_key._columnName)} = ${'a@b.c'}
`;
console.log(byKey[0]?.email);

// Value and type come from the same emit, so they can't drift apart.
const pk: DatabaseTables['users']['constraints'] =
  schema.users._constraints.users_pkey._constraintName;
console.log(pk); // 'users_pkey'
