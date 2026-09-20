import type { Queries } from '#queries.gen.ts';
import { sql } from 'bun';

const messages = await sql<Queries['ListMessages'][]>`SELECT id, body, created_at FROM messages ORDER BY created_at DESC`;

console.log(messages[0]?.body, messages[0]?.created_at.toISOString());

const counts = await sql<Array<Queries['CountMessages']>>`SELECT count(*) AS total FROM messages`;

console.log(counts[0]?.total);
