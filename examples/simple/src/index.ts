import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));

// LEFT JOIN makes the NOT NULL `amount` nullable; `updated_at` (timestamptz) is a Date.
const userDeals = await sql.GetUserDeals`
  SELECT u.id, u.email, u.display_name, d.amount, u.updated_at
  FROM users u
  LEFT JOIN deals d ON d.user_id = u.id
  WHERE u.id = ${1}
`;
console.log(userDeals[0]?.amount); // string | null
console.log(userDeals[0]?.updated_at.toISOString()); // updated_at: Date

// @ts-expect-error — `amount` is `string | null`, so it can't be used as a plain string
const amount: string = userDeals[0]!.amount;
console.log(amount);

// @ts-expect-error — `emial` isn't a column on the result
console.log(userDeals[0]?.emial);

// Single table, all columns NOT NULL → no `| null`.
const deals = await sql.ListDeals`
  SELECT id, status, amount FROM deals WHERE amount >= ${100}
`;
console.log(deals[0]?.status, deals[0]?.amount); // string, string

// CTE + joins: base columns trace their tables; COALESCE/COUNT/comparisons are nullable.
const summaries = await sql.GetDealSummaries`
  WITH deal_payments AS (
    SELECT deal_id, SUM(amount) AS paid, COUNT(*) AS payment_count
    FROM payments
    GROUP BY deal_id
  )
  SELECT
    d.id,
    d.status,
    u.email,
    d.amount                         AS deal_amount,
    COALESCE(dp.paid, 0)             AS total_paid,
    dp.payment_count,
    COALESCE(dp.paid, 0) >= d.amount AS fully_paid
  FROM deals d
  JOIN users u ON u.id = d.user_id
  LEFT JOIN deal_payments dp ON dp.deal_id = d.id
  WHERE u.id = ${1}
`;
console.log(summaries[0]?.fully_paid, summaries[0]?.payment_count); // boolean | null, string | null

// Through a VIEW: base columns keep their nullability; the computed `status_upper` is nullable.
const dealDetails = await sql.ListDealDetails`
  SELECT deal_id, status, amount, email, display_name, status_upper
  FROM deal_details
  WHERE status = ${'won'}
`;
console.log(dealDetails[0]?.status_upper); // string | null

// Composition: the `byStatus` fragment is inlined, its param numbered before the outer one.
const byStatus = sql`status = ${'won'}`;
const search = await sql.SearchDeals`
  SELECT id, status, amount FROM deals WHERE ${byStatus} AND amount >= ${100}
`;
console.log(search[0]?.amount); // string

// Nested fragments + `sql("deals")` identifier escape, all resolved statically.
const notArchived = sql`status <> 'archived'`;
const filters = sql`${notArchived} AND amount >= ${100}`;
const recent = await sql.RecentDeals`
  SELECT id, status FROM ${sql('deals')} WHERE ${filters}
`;
console.log(recent[0]?.status); // string

// Catalog types: enum → literal union, text[]/int4[] → typed arrays.
const meta = await sql.GetDealMeta`
  SELECT id, stage, tags, details, scores FROM deal_meta WHERE deal_id = ${1}
`;
console.log(meta[0]?.stage); // "lead" | "negotiation" | "won" | "lost"
console.log(meta[0]?.tags.join(','), meta[0]?.scores?.length); // string[], number[] | null

// `details` is typed AND documented by its COMMENT ON COLUMN — no per-query annotation.
const meta2 = await sql.GetDealDetails`
  SELECT id, details FROM deal_meta WHERE deal_id = ${1}
`;
console.log(meta2[0]?.details?.priority); // { priority: number; notes: string } | null

const counts = await sql.CountDeals`SELECT count(*) AS total FROM deals`;
console.log(counts[0]?.total); // string | null
