import { getDealMeta, getUserDeals } from './queries';

// Field access on query results is type-checked straight from the `sql.QueryName`
// inference — no manual annotations. (These calls would hit Postgres at runtime;
// here we only care that `tsc` enforces the shapes.)

const [deal] = await getUserDeals(1);
if (deal) {
  // `amount` is nullable (LEFT JOIN) and `display_name` is nullable in the schema,
  // so tsc forces the guards; `updated_at` is a `Date` (timestamptz).
  console.log(deal.email, deal.amount ?? 'no deals', deal.display_name?.toUpperCase());
  console.log(deal.updated_at.toISOString());

  // @ts-expect-error — `emial` isn't a column on the result
  console.log(deal.emial);
}

for (const meta of await getDealMeta(1)) {
  // `stage` is an enum union, `tags` a `string[]`, `details` the shape from its
  // COMMENT ON COLUMN, `scores` a nullable `number[]`.
  console.log(meta.stage, meta.tags.join(','), meta.details?.priority, meta.scores?.length);
}
