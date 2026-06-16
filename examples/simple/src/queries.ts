import { SQL } from 'bun';
import { type ICountDealsResult, withTypes } from './queries.gen';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));

// LEFT JOIN makes the NOT NULL `amount` nullable in the result.
export async function getUserDeals(userId: number) {
  return await sql.GetUserDeals`
    SELECT u.id, u.email, u.display_name, d.amount, u.updated_at
    FROM users u
    LEFT JOIN deals d ON d.user_id = u.id
    WHERE u.id = ${userId}
  `;
}

// Simple single-table query: status is NOT NULL, so no `| null`.
export async function listDeals(minAmount: number) {
  return await sql.ListDeals`
    SELECT id, status, amount
    FROM deals
    WHERE amount >= ${minAmount}
  `;
}

// CTE + INNER/LEFT joins + aliased base columns trace to their tables; aggregates
// and computed expressions (COALESCE, COUNT, comparison) come back nullable.
export async function getDealSummaries(userId: number) {
  return await sql.GetDealSummaries`
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
    WHERE u.id = ${userId}
  `;
}

// Through a VIEW: the planner inlines it, so base columns still trace their
// nullability; the view's computed `status_upper` is nullable.
export async function listDealDetails(status: string) {
  return await sql.ListDealDetails`
    SELECT deal_id, status, amount, email, display_name, status_upper
    FROM deal_details
    WHERE status = ${status}
  `;
}

// Composition: the `byStatus` fragment is inlined and its `${status}` numbered
// before the outer `${minAmount}`, matching Bun's runtime param order.
// biome-ignore lint/complexity/useMaxParams: example query function reads naturally with positional args
export async function searchDeals(status: string, minAmount: number) {
  const byStatus = sql`status = ${status}`;
  return await sql.SearchDeals`
    SELECT id, status, amount
    FROM deals
    WHERE ${byStatus} AND amount >= ${minAmount}
  `;
}

// Nested fragment inlining plus `sql("deals")` (identifier escape), resolved statically.
const NOT_ARCHIVED = sql`status <> 'archived'`;
export async function recentDeals(minAmount: number) {
  const filters = sql`${NOT_ARCHIVED} AND amount >= ${minAmount}`;
  return await sql.RecentDeals`
    SELECT id, status FROM ${sql('deals')} WHERE ${filters}
  `;
}

// Catalog-resolved types: ENUM → literal union, text[]/int4[] → typed arrays, jsonb → `unknown`.
export async function getDealMeta(dealId: number) {
  return await sql.GetDealMeta`
    SELECT id, stage, tags, details, scores
    FROM deal_meta
    WHERE deal_id = ${dealId}
  `;
}

// `@type` gives the json column a precise shape; nullability still applies on top.
export async function getDealDetails(dealId: number) {
  return await sql.GetDealDetails`
    /* @type details { priority: number; notes: string } */
    SELECT id, details
    FROM deal_meta
    WHERE deal_id = ${dealId}
  `;
}

// The explicit-generic escape hatch still works on the wrapped client: a `@name`
// comment names the generated interface, which the module also exports.
export async function countDeals() {
  return await sql<ICountDealsResult[]>`
    /* @name countDeals */
    SELECT count(*) AS total FROM deals
  `;
}
