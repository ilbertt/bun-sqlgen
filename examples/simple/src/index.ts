import type { DatabaseTables } from '@repo/bun-sqlgen';
import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';
import { schema } from '#queries.gen.ts';

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

// @ts-expect-error — `whatever` isn't a column on the result
console.log(userDeals[0]?.whatever);

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

// Through a VIEW: base columns keep their nullability, and the view's own column
// comments apply — including on `status_upper`, which no base column backs.
const dealDetails = await sql.ListDealDetails`
  SELECT deal_id, status, amount, email, display_name, status_upper
  FROM deal_details
  WHERE status = ${'won'}
`;
console.log(dealDetails[0]?.status_upper); // string
console.log(dealDetails[0]?.amount); // `${number}` — from the comment on `deal_details.amount`

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

// `display_name` is nullable in the schema, so `@notNull` narrows this query's field
// rather than repeating a type: the generated field is `NonNullable<IUsersColumns[...]>`.
const named = await sql.NamedUsers`
  /* @notNull display_name */
  SELECT id, display_name FROM users WHERE display_name IS NOT NULL
`;
console.log(named[0]?.display_name.length); // string — no null check needed

// The schema block: every table and view the migrations create, typed the same way as
// a query selecting it — no query has to mention a table for its row type to exist.
// It's the shape a row *reads back* as, generated columns included — not an insertable
// one, so `search_key` is here even though the database computes it.
type DealRow = DatabaseTables['deals']['columns'];
const draft: DealRow = {
  id: '1',
  user_id: '1',
  amount: '0',
  status: 'draft',
  search_key: 'draft',
};
console.log(draft.status);

// @ts-expect-error — `deals` has no `title` column
const bad: DealRow = { ...draft, title: 'nope' };
console.log(bad);

// Index and constraint names come along as literal unions, so anything naming one —
// an `ON CONFLICT ON CONSTRAINT`, a migration helper — is checked against the schema.
const onConflict: DatabaseTables['deal_meta']['constraints'] = 'deal_meta_pkey';
console.log(onConflict);

// @ts-expect-error — `deals` has no index by that name
const missingIndex: DatabaseTables['deals']['indexes'] = 'deals_status_idx';
console.log(missingIndex);

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

// A view is typed as one, and has no indexes — so that union is `never`.
const kind: DatabaseTables['deal_details']['relationType'] = 'view';
console.log(kind);

// @ts-expect-error — `deal_details` is a view; it has no indexes
const noIndex: DatabaseTables['deal_details']['indexes'] = 'anything';
console.log(noIndex);

// Foreign keys hang off the column they constrain, so a reference can be followed
// without knowing the constraint's name up front.
const dealsToUsers = schema.deals._columns.user_id._foreignKeys.deals_user_id_fkey;
console.log(dealsToUsers._references._relationName); // 'users'
console.log(dealsToUsers._references._columnName); // 'id'

// A composite key appears on each of its columns, each paired with the column it
// actually points at — `region` to `region`, `code` to `code`, not both to the first.
const notes = schema.tenant_notes._columns;
console.log(notes.region._foreignKeys.tenant_notes_tenant_fkey._references._columnName); // 'region'
console.log(notes.code._foreignKeys.tenant_notes_tenant_fkey._references._columnName); // 'code'

// @ts-expect-error — `body` participates in no foreign key, so its map is empty
console.log(notes.body._foreignKeys.tenant_notes_tenant_fkey);
