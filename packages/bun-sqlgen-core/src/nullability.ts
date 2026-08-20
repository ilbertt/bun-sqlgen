import type {
  Catalog,
  ColumnOverride,
  ColumnOverrides,
  ColumnSource,
  DescribeResult,
  NullabilityReason,
  Overrides,
  Provenance,
  RawColumnComments,
  ResolvedField,
  ResultField,
  SchemaTable,
} from '#types.ts';

/**
 * Resolve each result column's TS type and `| null`. A base-table column is
 * non-null iff it's NOT NULL *and* not on the nullable side of an outer join;
 * anything untraceable (expressions, aggregates, casts) is conservatively
 * nullable. Precedence: per-query `@notNull`/`@nullable` win, then the column's own
 * `COMMENT ON COLUMN` markers, then the catalog/introspector defaults. The base TS
 * type comes from the introspector (`f.ts`); a column comment's `@type` overrides it.
 */
export function resolveFields(input: {
  described: Pick<DescribeResult, 'fields' | 'provenance' | 'relations'>;
  catalog: Catalog;
  overrides: Overrides;
  columnOverrides: ColumnOverrides;
}): ResolvedField[] {
  const { described, catalog, overrides, columnOverrides } = input;
  // biome-ignore lint/complexity/useMaxParams: native map callback reads cleaner with the index
  return described.fields.map((f, i): ResolvedField => {
    const prov = described.provenance?.[i];
    const source = resolveSource({ prov, catalog });
    // A column comment matched either via provenance, or — for fields the planner
    // emits as expressions (e.g. VIRTUAL generated columns) — by name within a
    // single in-scope relation.
    const comment: ColumnOverride | undefined = source
      ? columnOverrides[source.table]?.[source.column]
      : commentByName({
          name: f.name,
          // An expression that traced to one relation names its owner; otherwise every
          // relation in scope is a candidate and only an unambiguous match counts.
          relations: prov?.kind === 'expr' && prov.relation ? [prov.relation] : described.relations,
          columnOverrides,
        });

    // A per-query `@type` is the most specific override there is: it names the exact
    // result column and gives its full TS type verbatim (nullability included), so it
    // wins over everything and skips the catalog/nullability heuristic entirely.
    const inlineType = overrides.types.get(f.name);
    if (inlineType) {
      return {
        name: f.name,
        ts: inlineType,
        nullable: false,
        reason: 'override',
        doc: comment?.doc,
      };
    }

    // Type: column-comment `@type` > the introspector's resolved type.
    const { ts, note } = commentType({ base: f, comment });

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
      const baseNotNull = commentNotNull({
        comment,
        fallback: catalog[source.table]?.[source.column] === true,
      });
      nullable = !baseNotNull || prov.outerNullable;
      reason =
        comment?.notNull || comment?.nullable
          ? 'comment'
          : prov.outerNullable && baseNotNull
            ? 'outer-join'
            : 'catalog';
    } else if (comment?.notNull) {
      // A comment describes the column, not the query: pulling it through an outer join
      // still makes it nullable here.
      nullable = prov?.outerNullable === true;
      reason = nullable ? 'outer-join' : 'comment';
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

    return {
      name: f.name,
      ts,
      nullable,
      reason,
      note,
      doc: comment?.doc,
      source: source ?? undefined,
    };
  });
}

/**
 * The same resolution for a base relation's own columns: a column comment's `@type`
 * overrides the introspector's type, its `@notNull`/`@nullable` override the schema's,
 * and its prose becomes the field's JSDoc. No query is in scope here, so there are no
 * per-query pragmas and no outer-join widening — just the column as the schema declares it.
 */
export function resolveTableColumns(input: {
  table: SchemaTable;
  columnOverrides: ColumnOverrides;
}): ResolvedField[] {
  const overrides = input.columnOverrides[input.table.name] ?? {};
  return input.table.columns.map((column): ResolvedField => {
    const comment = overrides[column.name];
    const { ts, note } = commentType({ base: column, comment });
    return {
      name: column.name,
      ts,
      nullable: !commentNotNull({ comment, fallback: column.notNull }),
      reason: comment?.notNull || comment?.nullable ? 'comment' : 'catalog',
      note,
      doc: comment?.doc,
    };
  });
}

// The two resolvers below are the only places a column comment is applied, and they have
// to agree: the schema block and every query selecting the column must report the same
// type. Both read the precedence from here rather than restating it.

// A comment's `@type` replaces the introspector's type — and its unmapped-type note with it.
function commentType(input: { base: ResultField; comment: ColumnOverride | undefined }): {
  ts: string;
  note?: string;
} {
  const tsType = input.comment?.tsType;
  return { ts: tsType ?? input.base.ts, note: tsType ? undefined : input.base.tsNote };
}

// `@notNull`/`@nullable` on a comment override whatever the schema declares.
function commentNotNull(input: {
  comment: ColumnOverride | undefined;
  fallback: boolean;
}): boolean {
  return input.comment?.notNull === true
    ? true
    : input.comment?.nullable === true
      ? false
      : input.fallback;
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
}): ColumnSource | null {
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

// `@notNull a b` / `@nullable a b` stop at the first `@` so a following pragma on the
// same comment isn't swallowed. `@type <col> <TsType>` takes one column then the rest
// of the line as the (possibly multi-word) type, trimming a trailing block-comment `*/`.
const NOT_NULL_PRAGMA = /@notNull\s+([^@\n*]+)/g;
const NULLABLE_PRAGMA = /@nullable\s+([^@\n*]+)/g;
const TYPE_PRAGMA = /@type\s+(\w+)\s+([^\n]+)/g;

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
    const tsType = m[2]!.replace(/\s*\*\/\s*$/, '').trim();
    if (tsType) {
      types.set(m[1]!, tsType);
    }
  }
  return { notNull, nullable, types };
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
  const out: ColumnOverrides = Object.create(null);
  for (const [table, columns] of Object.entries(raw)) {
    for (const [column, text] of Object.entries(columns)) {
      const override = parseColumnComment(text);
      if (override.notNull || override.nullable || override.tsType || override.doc) {
        out[table] ??= Object.create(null);
        out[table]![column] = override;
      }
    }
  }
  return out;
}
