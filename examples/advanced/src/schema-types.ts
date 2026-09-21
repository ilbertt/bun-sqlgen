import type { DatabaseTables } from '@repo/bun-sqlgen';

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
