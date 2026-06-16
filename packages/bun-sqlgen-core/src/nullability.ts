import { oidToTs } from '#oids.ts';
import type {
  Catalog,
  DescribeResult,
  NullabilityReason,
  Overrides,
  ResolvedField,
  TypeCatalog,
} from '#types.ts';

/**
 * Resolve each result column's TS type and `| null`. A base-table column is
 * non-null iff it's NOT NULL *and* not on the nullable side of an outer join;
 * anything untraceable (expressions, aggregates, casts) is conservatively
 * nullable; `@notNull`/`@nullable` overrides win.
 */
export function resolveFields(input: {
  described: Pick<DescribeResult, 'fields' | 'provenance'>;
  catalog: Catalog;
  overrides: Overrides;
  types: TypeCatalog;
}): ResolvedField[] {
  const { described, catalog, overrides, types } = input;
  // biome-ignore lint/complexity/useMaxParams: native map callback reads cleaner with the index
  return described.fields.map((f, i): ResolvedField => {
    // `@type` overrides the OID mapping (e.g. a precise shape for json); nullability still below.
    const typeOverride = overrides.types.get(f.name);
    const { ts, note } = typeOverride
      ? { ts: typeOverride, note: undefined }
      : oidToTs({ oid: f.oid, types });
    const prov = described.provenance?.[i];

    let nullable: boolean;
    let reason: NullabilityReason;
    if (overrides.notNull.has(f.name)) {
      nullable = false;
      reason = 'override';
    } else if (overrides.nullable.has(f.name)) {
      nullable = true;
      reason = 'override';
    } else if (prov?.kind === 'column') {
      // Source table: from the alias, or the unique in-scope relation owning a bare column.
      let table = prov.table;
      if (!table && prov.candidates) {
        const owners = prov.candidates.filter((t) => prov.column in (catalog[t] ?? {}));
        if (owners.length === 1) {
          table = owners[0]!;
        }
      }
      if (table) {
        const baseNotNull = catalog[table]?.[prov.column] === true;
        nullable = !baseNotNull || prov.outerNullable;
        reason = prov.outerNullable && baseNotNull ? 'outer-join' : 'catalog';
      } else {
        nullable = true;
        reason = 'unresolved';
      }
    } else {
      nullable = true;
      reason = 'expr';
    }

    return { name: f.name, ts, nullable, reason, note };
  });
}

const NOT_NULL_PRAGMA = /@notNull\s+([\w\s]+)/g;
const NULLABLE_PRAGMA = /@nullable\s+([\w\s]+)/g;
const TYPE_PRAGMA = /@type\s+(\w+)\s+([^\n*]+)/g;

// `@type` captures the rest of its line, so it can hold spaces/generics:
// `@type details { priority: number; notes: string }`.
export function parseOverrides(commentText = ''): Overrides {
  const notNull = new Set<string>();
  const nullable = new Set<string>();
  const types = new Map<string, string>();
  for (const m of commentText.matchAll(NOT_NULL_PRAGMA)) {
    for (const c of m[1]!.trim().split(/\s+/)) {
      notNull.add(c);
    }
  }
  for (const m of commentText.matchAll(NULLABLE_PRAGMA)) {
    for (const c of m[1]!.trim().split(/\s+/)) {
      nullable.add(c);
    }
  }
  for (const m of commentText.matchAll(TYPE_PRAGMA)) {
    types.set(m[1]!, m[2]!.trim()); // stop before a closing `*/`
  }
  return { notNull, nullable, types };
}
