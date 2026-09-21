import { sql } from '#client.ts';

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
