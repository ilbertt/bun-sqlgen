import { sql } from '#client.ts';

// A VIRTUAL generated column reaches the plan as its generating expression, so it has
// no column provenance — the `@notNull` on its COMMENT ON COLUMN is what types it.
const keys = await sql.UserSearchKeys`
  SELECT u.search_key FROM users u WHERE u.id = ${1}
`;
console.log(keys[0]?.search_key.length); // string

// Same column, but now two joined tables both comment a `search_key`.
const joined = await sql.DealSearchKeys`
  SELECT u.search_key FROM users u JOIN deals d ON d.user_id = u.id
`;
console.log(joined[0]?.search_key.length); // string

// The comment describes the column, not the query: pulled through a LEFT JOIN, the
// `@notNull` generated column is nullable here after all.
const optional = await sql.OptionalSearchKeys`
  SELECT d.search_key FROM users u LEFT JOIN deals d ON d.user_id = u.id
`;
console.log(optional[0]?.search_key?.length); // string | null
