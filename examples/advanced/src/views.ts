import type { DatabaseTables } from '@repo/bun-sqlgen';
import { sql } from '#client.ts';

// Through a VIEW: base columns keep their nullability, and the view's own column
// comments apply — including on `status_upper`, which no base column backs.
const dealDetails = await sql.ListDealDetails`
  SELECT deal_id, status, amount, email, display_name, status_upper
  FROM deal_details
  WHERE status = ${'won'}
`;
console.log(dealDetails[0]?.status_upper); // string
console.log(dealDetails[0]?.status); // 'draft' | 'won' | 'lost' — the view's own comment

// A view comment carrying only prose layers over the base column's instead of replacing
// it: the JSDoc is the view's, the `@type` and the `@notNull` still the table's.
const desired = await sql.ListDesiredDeployments`
  SELECT deployment_state, deployment_digest FROM desired_deployments
`;
console.log(desired[0]?.deployment_state === 'failed'); // 'pending' | 'running' | 'failed'
console.log(desired[0]?.deployment_digest.length); // string — not null, per the base column

// A view is typed as one, and has no indexes — so that union is `never`.
const kind: DatabaseTables['deal_details']['relationType'] = 'view';
console.log(kind);

// @ts-expect-error — `deal_details` is a view; it has no indexes
const noIndex: DatabaseTables['deal_details']['indexes'] = 'anything';
console.log(noIndex);

// A view column's own schema entry layers over the base column's comment the same way a
// query through the view does, so both report one type — and `deployment_config`, which
// the view doesn't comment at all, inherits the base column's `@type` and JSDoc outright.
// Nullability stays the view's answer: a view is free to LEFT JOIN, and nothing tracks
// `NOT NULL` through one, so the pinned `deployments.digest` is still nullable here.
type DesiredDeploymentRow = DatabaseTables['desired_deployments']['columns'];
const desiredRow: DesiredDeploymentRow = {
  deployment_id: '1',
  deployment_state: 'running',
  deployment_digest: null,
  deployment_config: { replicas: 2 },
};
console.log(desiredRow.deployment_state, desiredRow.deployment_config?.replicas);

// @ts-expect-error — `deployment_state` carries the base column's `@type`, not `string`
const badState: DesiredDeploymentRow = { ...desiredRow, deployment_state: 'nope' };
console.log(badState);
