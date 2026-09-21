import { sql } from '#client.ts';

// `display_name` is nullable in the schema, so `@notNull` narrows this query's field
// rather than repeating a type: the generated field is `NonNullable<IUsersColumns[...]>`.
const named = await sql.NamedUsers`
  /* @notNull display_name */
  SELECT id, display_name FROM users WHERE display_name IS NOT NULL
`;
console.log(named[0]?.display_name.length); // string — no null check needed
