import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'sqlite://:memory:'));

// BOOLEAN and REAL both read back as `number` under Bun.SQL.
const deals = await sql.ListDeals`
  SELECT id, status, amount, is_active FROM deals WHERE amount >= ${100}
`;
console.log(deals[0]?.status, deals[0]?.amount, deals[0]?.is_active); // string, number, number

// @ts-expect-error — `staus` isn't a column on the result
console.log(deals[0]?.staus);

// `closed_at` (DATETIME) is a `string`, not a `Date`; nullable `attachment` (BLOB).
const detail = await sql.GetDeal`
  SELECT id, amount, attachment, closed_at FROM deals WHERE id = ${1}
`;
console.log(detail[0]?.attachment, detail[0]?.closed_at); // Uint8Array | null, string | null

// SQLite has no column-origin metadata, so any outer join widens every column to null.
const userDeals = await sql.GetUserDeals`
  SELECT u.id, u.email, d.amount FROM users u
  LEFT JOIN deals d ON d.user_id = u.id
  WHERE u.id = ${1}
`;
console.log(userDeals[0]?.email); // string | null

// `@notNull` overrides that conservative widening.
const userEmails = await sql.UserEmails`
  /* @notNull email */
  SELECT u.email, d.amount FROM users u
  LEFT JOIN deals d ON d.user_id = u.id
`;
console.log(userEmails[0]?.email.toUpperCase()); // email: string

// Expressions have no declared type: `count` → `number` via the storage class, the
// rest fall back to `unknown`.
const stats = await sql.DealStats`
  SELECT count(*) AS total, upper(status) AS loud FROM deals
`;
console.log(stats[0]?.total, stats[0]?.loud); // number | null, unknown | null

// `byStatus` is inlined and its param numbered `?1` before the outer `?2`.
const byStatus = sql`status = ${'won'}`;
const search = await sql.SearchDeals`
  SELECT id, status, amount FROM deals WHERE ${byStatus} AND amount >= ${100}
`;
console.log(search[0]?.amount); // number
