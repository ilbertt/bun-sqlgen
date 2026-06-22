import { oidToTs } from '#oids.ts';
import type {
  Catalog,
  ColumnOverride,
  ColumnOverrides,
  DescribeResult,
  NullabilityReason,
  Overrides,
  Provenance,
  RawColumnComments,
  ResolvedField,
  TypeCatalog,
} from '#types.ts';

/**
 * Resolve each result column's TS type and `| null`. A base-table column is
 * non-null iff it's NOT NULL *and* not on the nullable side of an outer join;
 * anything untraceable (expressions, aggregates, casts) is conservatively
 * nullable. Precedence: per-query `@notNull`/`@nullable` win, then the column's own
 * `COMMENT ON COLUMN` markers, then the catalog/OID defaults. A column's TS type and
 * its JSDoc both come from its comment (`@type` + prose).
 */
export function resolveFields(input: {
  described: Pick<DescribeResult, 'fields' | 'provenance' | 'relations'>;
  catalog: Catalog;
  overrides: Overrides;
  columnOverrides: ColumnOverrides;
  types: TypeCatalog;
}): ResolvedField[] {
  const { described, catalog, overrides, columnOverrides, types } = input;
  // biome-ignore lint/complexity/useMaxParams: native map callback reads cleaner with the index
  return described.fields.map((f, i): ResolvedField => {
    const prov = described.provenance?.[i];
    const source = resolveSource({ prov, catalog });
    // A column comment matched either via provenance, or — for fields the planner
    // emits as expressions (e.g. VIRTUAL generated columns) — by name within a
    // single in-scope relation.
    const comment: ColumnOverride | undefined = source
      ? columnOverrides[source.table]?.[source.column]
      : commentByName({ name: f.name, relations: described.relations, columnOverrides });

    // Type: column-comment `@type` > OID mapping.
    const tsType = comment?.tsType;
    const { ts, note } = tsType ? { ts: tsType, note: undefined } : oidToTs({ oid: f.oid, types });

    let nullable: boolean;
    let reason: NullabilityReason;
    if (overrides.notNull.has(f.name)) {
      nullable = false;
      reason = 'override';
    } else if (overrides.nullable.has(f.name)) {
      nullable = true;
      reason = 'override';
    } else if (source && prov?.kind === 'column') {
      // A column comment sets the base nullability (catalog otherwise); outer-join
      // widening still applies on top.
      const baseNotNull =
        comment?.notNull === true
          ? true
          : comment?.nullable === true
            ? false
            : catalog[source.table]?.[source.column] === true;
      nullable = !baseNotNull || prov.outerNullable;
      reason =
        comment?.notNull || comment?.nullable
          ? 'comment'
          : prov.outerNullable && baseNotNull
            ? 'outer-join'
            : 'catalog';
    } else if (comment?.notNull) {
      nullable = false;
      reason = 'comment';
    } else if (comment?.nullable) {
      nullable = true;
      reason = 'comment';
    } else if (prov?.kind === 'column') {
      nullable = true;
      reason = 'unresolved';
    } else {
      nullable = true;
      reason = 'expr';
    }

    return { name: f.name, ts, nullable, reason, note, doc: comment?.doc };
  });
}

// A comment override for a field name owned by exactly one in-scope relation.
function commentByName(input: {
  name: string;
  relations: string[];
  columnOverrides: ColumnOverrides;
}): ColumnOverride | undefined {
  const owners = input.relations.filter((t) => input.columnOverrides[t]?.[input.name]);
  return owners.length === 1 ? input.columnOverrides[owners[0]!]![input.name] : undefined;
}

// The base table + column a result field traces to (for catalog/comment lookups),
// resolving a bare column to the unique in-scope relation that owns it.
function resolveSource(input: {
  prov: Provenance | undefined;
  catalog: Catalog;
}): { table: string; column: string } | null {
  const { prov, catalog } = input;
  if (prov?.kind !== 'column') {
    return null;
  }
  let table = prov.table;
  if (!table && prov.candidates) {
    const owners = prov.candidates.filter((t) => prov.column in (catalog[t] ?? {}));
    if (owners.length === 1) {
      table = owners[0]!;
    }
  }
  return table ? { table, column: prov.column } : null;
}

const NOT_NULL_PRAGMA = /@notNull\s+([\w\s]+)/g;
const NULLABLE_PRAGMA = /@nullable\s+([\w\s]+)/g;

// Per-query overrides name the columns they apply to (`@notNull a b`). Typing a
// column is a fact about the column, not a query — so `@type` lives only on a
// `COMMENT ON COLUMN`, never here.
export function parseOverrides(commentText = ''): Overrides {
  const notNull = new Set<string>();
  const nullable = new Set<string>();
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
  return { notNull, nullable };
}

const COMMENT_TYPE_MARKER = /@type\s+([^\n]+)/;
// Markers to strip when reducing a column comment to its prose (its JSDoc).
const COMMENT_MARKERS = /@type\s+[^\n]*|@(?:notNull|nullable)\b/g;

// Parse a single column's `COMMENT ON COLUMN` text. The column is implicit, so the
// markers are bare: `@notNull`, `@nullable`, `@type <TsType>` — mixed freely with
// prose, which (markers removed) becomes the generated field's JSDoc.
export function parseColumnComment(text: string): ColumnOverride {
  const typeMatch = COMMENT_TYPE_MARKER.exec(text);
  const doc = text.replace(COMMENT_MARKERS, '').replace(/\s+/g, ' ').trim();
  return {
    notNull: /@notNull\b/.test(text),
    nullable: /@nullable\b/.test(text),
    tsType: typeMatch?.[1]?.trim(),
    doc: doc || undefined,
  };
}

// Parse every column comment; keep any that carries a marker or documentation.
export function parseColumnComments(raw: RawColumnComments): ColumnOverrides {
  const out: ColumnOverrides = {};
  for (const [table, columns] of Object.entries(raw)) {
    for (const [column, text] of Object.entries(columns)) {
      const override = parseColumnComment(text);
      if (override.notNull || override.nullable || override.tsType || override.doc) {
        out[table] ??= {};
        out[table]![column] = override;
      }
    }
  }
  return out;
}
