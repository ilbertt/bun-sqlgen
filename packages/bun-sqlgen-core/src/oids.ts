import type { TypeCatalog } from '#types.ts';

/** `pg_type` OIDs, shared with `introspect.ts`'s EXPLAIN dummy values. */
// biome-ignore-start lint/style/noMagicNumbers: Postgres OIDs are fixed catalog identifiers
export const PG_OID = {
  bool: 16,
  bytea: 17,
  char: 18,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  oid: 26,
  json: 114,
  float4: 700,
  float8: 701,
  text: 25,
  bpchar: 1042,
  varchar: 1043,
  uuid: 2950,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  jsonb: 3802,
  numeric: 1700,
  boolArray: 1000,
  int2Array: 1005,
  int4Array: 1007,
  int8Array: 1016,
  textArray: 1009,
  varcharArray: 1015,
} as const;
// biome-ignore-end lint/style/noMagicNumbers: Postgres OIDs are fixed catalog identifiers

// Tuned for how Bun.sql returns values: int8/numeric as strings (precision),
// bytea as Uint8Array, timestamps as Date.
const OID_TO_TS: Record<number, string> = {
  [PG_OID.bool]: 'boolean',
  [PG_OID.bytea]: 'Uint8Array',
  [PG_OID.int8]: 'string',
  [PG_OID.int2]: 'number',
  [PG_OID.int4]: 'number',
  [PG_OID.oid]: 'number',
  [PG_OID.float4]: 'number',
  [PG_OID.float8]: 'number',
  [PG_OID.numeric]: 'string',
  [PG_OID.char]: 'string',
  [PG_OID.name]: 'string',
  [PG_OID.text]: 'string',
  [PG_OID.bpchar]: 'string',
  [PG_OID.varchar]: 'string',
  [PG_OID.uuid]: 'string',
  [PG_OID.date]: 'string',
  [PG_OID.time]: 'string',
  [PG_OID.timestamp]: 'Date',
  [PG_OID.timestamptz]: 'Date',
  [PG_OID.json]: 'unknown',
  [PG_OID.jsonb]: 'unknown',
  [PG_OID.boolArray]: 'boolean[]',
  [PG_OID.int2Array]: 'number[]',
  [PG_OID.int4Array]: 'number[]',
  [PG_OID.int8Array]: 'string[]',
  [PG_OID.textArray]: 'string[]',
  [PG_OID.varcharArray]: 'string[]',
};

/** The TS type for an OID, plus an optional note when it couldn't be mapped. */
export interface TsType {
  ts: string;
  note?: string;
}

export function oidToTs(input: { oid: number; types: TypeCatalog }): TsType {
  return resolve({ oid: input.oid, types: input.types, seen: new Set() });
}

// Recurses through the dynamic type catalog: enum -> label union, domain -> base
// type, array -> `Element[]`.
function resolve(input: { oid: number; types: TypeCatalog; seen: Set<number> }): TsType {
  const { oid, types, seen } = input;
  const base = OID_TO_TS[oid];
  if (base) {
    return { ts: base };
  }

  const info = types.get(oid);
  if (!info || seen.has(oid)) {
    return { ts: 'unknown', note: `unmapped oid ${oid} - add to oids.ts` };
  }
  seen.add(oid); // guard against pathological domain/array cycles

  if (info.kind === 'enum') {
    return { ts: info.labels.length ? info.labels.map(quote).join(' | ') : 'string' };
  }
  if (info.kind === 'domain') {
    return resolve({ oid: info.baseOid, types, seen });
  }
  if (info.kind === 'array') {
    const el = resolve({ oid: info.elemOid, types, seen });
    const inner = el.ts.includes(' | ') ? `(${el.ts})` : el.ts; // parenthesize unions
    return { ts: `${inner}[]`, note: el.note };
  }
  return {
    ts: 'unknown',
    note: `unmapped ${info.kind} type "${info.name}" (oid ${oid}) - add to oids.ts`,
  };
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
