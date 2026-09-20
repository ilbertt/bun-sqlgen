import { sql } from '#client.ts';

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
