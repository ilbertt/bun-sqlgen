import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));

// Each field is typed as `Bun.sql` returns it, and `display_name` — the one column
// without NOT NULL — is the only nullable one.
const users = await sql.GetUser`
  SELECT id, email, display_name, login_count, is_admin, created_at
  FROM users WHERE id = ${1}
`;
console.log(users[0]?.id); // string — a bigint is a string, not a number
console.log(users[0]?.email, users[0]?.display_name); // string, string | null
console.log(users[0]?.login_count, users[0]?.is_admin); // number, boolean
console.log(users[0]?.created_at.toISOString()); // Date

// @ts-expect-error — `display_name` is `string | null`, so it can't be used as a plain string
const name: string = users[0]!.display_name;
console.log(name);

// @ts-expect-error — `whatever` isn't a column on the result
console.log(users[0]?.whatever);
