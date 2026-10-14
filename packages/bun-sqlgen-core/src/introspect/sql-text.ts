/**
 * Reading a statement as text — what neither the catalog nor the plan can answer.
 * SQLite has no describe protocol to name a query's relations, and Postgres rewrites
 * a view away before planning, so both dialects fall back to the same scan.
 */

/** A quoted or bare identifier, in every quoting style the two dialects accept. */
export const IDENT = String.raw`"[^"]*"|\`[^\`]*\`|\[[^\]]*\]|[A-Za-z_]\w*`;

// Line comments, block comments and string literals hold text that looks like SQL and
// isn't — a `'x from y'` literal names no relation. Blanked before a scan, not matched around.
const NOISE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g;

export function stripNoise(sql: string): string {
  return sql.replace(NOISE, ' ');
}

export function unquoteIdent(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  if (s.startsWith('`') && s.endsWith('`')) {
    return s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1);
  }
  return s;
}

export const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;

const RELATION_REF = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+(${IDENT})(?:\s*\.\s*(${IDENT}))?`,
  'gi',
);

/**
 * The relations a statement names, scanned from its FROM/JOIN/UPDATE/INTO clauses.
 * Subqueries (whose next token is `(`) don't match; CTE names that slip through simply
 * miss in the catalog.
 */
export function parseRelations(input: string | { sql: string; qualified: boolean }): string[] {
  const sql = typeof input === 'string' ? input : input.sql;
  const qualified = typeof input !== 'string' && input.qualified;
  const out = new Set<string>();
  for (const m of stripNoise(sql).matchAll(RELATION_REF)) {
    const name = unquoteIdent(m[2] ?? m[1]!);
    out.add(qualified && m[2] ? `${quoteIdent(unquoteIdent(m[1]!))}.${quoteIdent(name)}` : name);
  }
  return [...out];
}
