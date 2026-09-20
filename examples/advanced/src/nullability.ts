import { sql } from '#client.ts';

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

// An aggregate with no base column is an expression, so it's conservatively nullable.
const counts = await sql.CountDeals`SELECT count(*) AS total FROM deals`;
console.log(counts[0]?.total); // string | null
