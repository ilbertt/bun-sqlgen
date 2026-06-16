import { sql } from 'bun';
import type {
  IGetDealDetailsResult,
  IGetDealMetaResult,
  IGetDealSummariesResult,
  IGetUserDealsResult,
  IListDealDetailsResult,
  IListDealsResult,
  IRecentDealsResult,
  ISearchDealsResult,
  IUnnamedQuery1Result,
} from './queries.gen';

// LEFT JOIN makes the NOT NULL `amount` nullable in the result.
export async function getUserDeals(userId: number) {
  const rows = await sql<IGetUserDealsResult[]>`
    /* @name getUserDeals */
    SELECT u.id, u.email, u.display_name, d.amount, u.updated_at
    FROM users u
    LEFT JOIN deals d ON d.user_id = u.id
    WHERE u.id = ${userId}
  `;
  return rows;
}

// Simple single-table query: status is NOT NULL, so no `| null`.
export async function listDeals(minAmount: number) {
  const rows = await sql<IListDealsResult[]>`
    /* @name listDeals */
    SELECT id, status, amount
    FROM deals
    WHERE amount >= ${minAmount}
  `;
  return rows;
}

// CTE + INNER/LEFT joins + aliased base columns trace to their tables; aggregates
// and computed expressions (COALESCE, COUNT, comparison) come back nullable.
export async function getDealSummaries(userId: number) {
  const rows = await sql<IGetDealSummariesResult[]>`
    /* @name getDealSummaries */
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
  return rows;
}

// Through a VIEW: the planner inlines it, so base columns still trace their
// nullability; the view's computed `status_upper` is nullable.
export async function listDealDetails(status: string) {
  const rows = await sql<IListDealDetailsResult[]>`
    /* @name listDealDetails */
    SELECT deal_id, status, amount, email, display_name, status_upper
    FROM deal_details
    WHERE status = ${status}
  `;
  return rows;
}

// Composition: the `byStatus` fragment is inlined and its `${status}` numbered
// before the outer `${minAmount}`, matching Bun's runtime param order.
// biome-ignore lint/complexity/useMaxParams: example query function reads naturally with positional args
export async function searchDeals(status: string, minAmount: number) {
  const byStatus = sql`status = ${status}`;
  const rows = await sql<ISearchDealsResult[]>`
    /* @name searchDeals */
    SELECT id, status, amount
    FROM deals
    WHERE ${byStatus} AND amount >= ${minAmount}
  `;
  return rows;
}

// Nested fragment inlining plus `sql("deals")` (identifier escape), resolved statically.
const NOT_ARCHIVED = sql`status <> 'archived'`;
export async function recentDeals(minAmount: number) {
  const filters = sql`${NOT_ARCHIVED} AND amount >= ${minAmount}`;
  const rows = await sql<IRecentDealsResult[]>`
    /* @name recentDeals */
    SELECT id, status FROM ${sql('deals')} WHERE ${filters}
  `;
  return rows;
}

// Catalog-resolved types: ENUM → literal union, text[]/int4[] → typed arrays, jsonb → `unknown`.
export async function getDealMeta(dealId: number) {
  const rows = await sql<IGetDealMetaResult[]>`
    /* @name getDealMeta */
    SELECT id, stage, tags, details, scores
    FROM deal_meta
    WHERE deal_id = ${dealId}
  `;
  return rows;
}

// `@type` gives the json column a precise shape; nullability still applies on top.
export async function getDealDetails(dealId: number) {
  const rows = await sql<IGetDealDetailsResult[]>`
    /* @name getDealDetails */
    /* @type details { priority: number; notes: string } */
    SELECT id, details
    FROM deal_meta
    WHERE deal_id = ${dealId}
  `;
  return rows;
}

// No `@name` → falls back to `IUnnamedQuery1Result` (a nudge to name it).
export async function countDeals() {
  const rows = await sql<IUnnamedQuery1Result[]>`
    SELECT count(*) AS total FROM deals
  `;
  return rows;
}
