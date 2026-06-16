import type { IGetUserDealsResult } from './queries.gen';

// A generated row type; tsc enforces its shape and `| null`s. `bun run codegen` refreshes it.
const example: IGetUserDealsResult = {
  id: '1',
  email: 'ada@example.com',
  display_name: null,
  amount: null,
  updated_at: new Date(),
};

console.log(`${example.email}: ${example.amount ?? 'no deals'}`);
