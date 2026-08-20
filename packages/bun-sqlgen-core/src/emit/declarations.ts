import ts from '@typescript/typescript6';
import {
  columnsName,
  f,
  pascalCase,
  propertyName,
  resultName,
  tableName,
  typeNode,
  valuePropertyName,
} from '#emit/ast.ts';
import type { ColumnForeignKey, EmitColumn, EmitModel, EmitTable, ResolvedField } from '#types.ts';

// The registry interfaces the generated module emits; names must match what
// `@ilbertt/bun-sqlgen` declares. `REGISTRY`/`TABLE_REGISTRY` are the exported,
// importable registries; the `GLOBAL_*` names are the package's ambient interfaces
// they merge into.
const REGISTRY = 'Queries';
const GLOBAL_REGISTRY = 'QueryResults';
const TABLE_REGISTRY = 'Tables';
// The runtime half of the schema block: the same names, as values.
const SCHEMA_VALUE = 'schema';
const GLOBAL_TABLE_REGISTRY = 'DatabaseTables';

function exported(): ts.Modifier {
  return f.createModifier(ts.SyntaxKind.ExportKeyword);
}

function docComment(input: { node: ts.Node; text: string }): void {
  ts.addSyntheticLeadingComment(
    input.node,
    ts.SyntaxKind.MultiLineCommentTrivia,
    `* ${input.text} `,
    true,
  );
}

/**
 * The emitted schema block, keyed by relation name: the interface each one's columns
 * landed in, and those columns by name. Result fields look themselves up here to
 * reference their source column instead of repeating its type.
 */
export type SchemaIndex = Map<string, { base: string; columns: Map<string, ResolvedField> }>;

export function schemaIndex(tables: EmitTable[]): SchemaIndex {
  const bases = uniqueBases(tables);
  return new Map(
    tables.map((table) => [
      table.name,
      {
        base: bases.get(table.name)!,
        columns: new Map(table.columns.map((column) => [column.name, column])),
      },
    ]),
  );
}

/**
 * A field's type as a reference into the schema block — `IUsersColumns['email']` — so
 * the column it came from travels with the type instead of being flattened away. Only
 * when the two agree on the type: a per-query `@type`, or a column the dialect
 * describes differently in a query than in the catalog, keeps its own.
 */
function columnReference(input: {
  field: ResolvedField;
  schema: SchemaIndex | undefined;
}): { node: ts.TypeNode; nullable: boolean } | null {
  const { field, schema } = input;
  const relation = field.source && schema?.get(field.source.table);
  const column = relation?.columns.get(field.source!.column);
  if (!relation || !column || column.ts !== field.ts) {
    return null;
  }
  return {
    node: f.createIndexedAccessTypeNode(
      f.createTypeReferenceNode(columnsName(relation.base)),
      f.createLiteralTypeNode(f.createStringLiteral(field.source!.column)),
    ),
    nullable: column.nullable,
  };
}

// Nullability stays a per-query answer, so the reference is widened where an outer join
// made the column nullable and narrowed where a `@notNull` pragma pinned it.
function fieldType(input: { field: ResolvedField; schema: SchemaIndex | undefined }): ts.TypeNode {
  const { field } = input;
  const ref = columnReference(input);
  if (!ref) {
    return typeNode(field.nullable ? `${field.ts} | null` : field.ts);
  }
  if (ref.nullable === field.nullable) {
    return ref.node;
  }
  return field.nullable
    ? f.createUnionTypeNode([ref.node, f.createLiteralTypeNode(f.createNull())])
    : f.createTypeReferenceNode('NonNullable', [ref.node]);
}

// `schema` is left out for the schema block's own columns — they are what everything
// else points at, so they carry the resolved type itself.
function fieldSignature(input: {
  field: ResolvedField;
  schema?: SchemaIndex;
}): ts.PropertySignature {
  const { field } = input;
  const type = fieldType({ field, schema: input.schema });
  const sig = f.createPropertySignature(undefined, propertyName(field.name), undefined, type);
  // The source column's comment prose, ported as JSDoc.
  if (field.doc) {
    ts.addSyntheticLeadingComment(
      sig,
      ts.SyntaxKind.MultiLineCommentTrivia,
      `* ${field.doc} `,
      true,
    );
  }
  if (field.note) {
    ts.addSyntheticLeadingComment(
      sig,
      ts.SyntaxKind.SingleLineCommentTrivia,
      ` ${field.note}`,
      true,
    );
  }
  return sig;
}

// The row interface backing one registry entry. Exported so the row type stays
// nameable when a consumer re-emits it in a `.d.ts` (declaration emission or
// bundling) — TypeScript dereferences `QueryResults['Name']` to this interface and
// errors (TS4053) if it can't name it. `QueryResults['Name']` is still the intended
// access path; the export just keeps the underlying name reachable.
export function resultInterface(input: {
  query: EmitModel;
  schema: SchemaIndex;
}): ts.InterfaceDeclaration {
  const { query } = input;
  const node = f.createInterfaceDeclaration(
    [exported()],
    resultName(query.name),
    undefined,
    undefined,
    query.resultFields.map((field) => fieldSignature({ field, schema: input.schema })),
  );
  docComment({ node, text: `Result of query \`${query.name}\`.` });
  return node;
}

// `export interface Queries { Foo: IFooResult; ... }` — the importable registry of
// query name→row. Threaded explicitly via `withTypes<Queries>(sql)` so the types
// travel through the import graph; also the single source the global augmentation
// extends.
export function registryInterface(queries: EmitModel[]): ts.InterfaceDeclaration {
  return f.createInterfaceDeclaration(
    [exported()],
    REGISTRY,
    undefined,
    undefined,
    queries.map((q) =>
      f.createPropertySignature(
        undefined,
        propertyName(q.name),
        undefined,
        f.createTypeReferenceNode(resultName(q.name)),
      ),
    ),
  );
}

// `(typeof schema)["users"]["_indexes"]`, the node map behind one relation member.
function schemaMember(input: { table: string; key: string }): ts.TypeNode {
  const at = (member: { object: ts.TypeNode; key: string }): ts.TypeNode =>
    f.createIndexedAccessTypeNode(
      member.object,
      f.createLiteralTypeNode(f.createStringLiteral(member.key)),
    );
  const relation = at({
    object: f.createTypeQueryNode(f.createIdentifier(SCHEMA_VALUE)),
    key: input.table,
  });
  return at({ object: relation, key: input.key });
}

// The names read back off the emitted const rather than repeated. An empty node map
// gives `never`, which is what a relation with no indexes should give.
const namesUnion = (input: { table: string; key: string }): ts.TypeNode =>
  f.createTypeOperatorNode(ts.SyntaxKind.KeyOfKeyword, schemaMember(input));

// `{ id: { _columnName: "id" }, … }` — every node is an object carrying its own name,
// so detail (a column's foreign keys, an index's columns) can be added later as another
// `_` key without changing how the identifier is read.
function nodeMap(input: { names: string[]; nameKey: string }): ts.Expression {
  return f.createObjectLiteralExpression(
    input.names.map((name) =>
      f.createPropertyAssignment(
        valuePropertyName(name),
        f.createObjectLiteralExpression([
          f.createPropertyAssignment(input.nameKey, f.createStringLiteral(name)),
        ]),
      ),
    ),
    true,
  );
}

// `{ deal_id: { _columnName: "deal_id", _foreignKeys: { … } } }`. Column nodes carry
// more than a name, so they don't go through `nodeMap`.
function columnNodes(columns: EmitColumn[]): ts.Expression {
  const references = (fk: ColumnForeignKey): ts.Expression =>
    f.createObjectLiteralExpression([
      f.createPropertyAssignment('_relationName', f.createStringLiteral(fk.references.table)),
      f.createPropertyAssignment('_columnName', f.createStringLiteral(fk.references.column)),
    ]);
  const foreignKeys = (column: EmitColumn): ts.Expression =>
    f.createObjectLiteralExpression(
      column.foreignKeys.map((fk) =>
        f.createPropertyAssignment(
          valuePropertyName(fk.name),
          f.createObjectLiteralExpression([
            f.createPropertyAssignment('_constraintName', f.createStringLiteral(fk.name)),
            f.createPropertyAssignment('_references', references(fk)),
          ]),
        ),
      ),
    );
  return f.createObjectLiteralExpression(
    columns.map((column) =>
      f.createPropertyAssignment(
        valuePropertyName(column.name),
        f.createObjectLiteralExpression([
          f.createPropertyAssignment('_columnName', f.createStringLiteral(column.name)),
          f.createPropertyAssignment('_foreignKeys', foreignKeys(column)),
        ]),
      ),
    ),
    true,
  );
}

/**
 * `export const schema = { … } as const` — the schema as values, so an identifier can
 * be reached at runtime and still be checked: `schema.payments._columns.id._columnName`
 * is `"id"`, and a column that doesn't exist is a compile error.
 */
function schemaValue(tables: EmitTable[]): ts.VariableStatement {
  const entry = (table: EmitTable): ts.Expression =>
    f.createObjectLiteralExpression(
      [
        f.createPropertyAssignment('_relationName', f.createStringLiteral(table.name)),
        f.createPropertyAssignment('_relationType', f.createStringLiteral(table.kind)),
        f.createPropertyAssignment('_columns', columnNodes(table.columns)),
        f.createPropertyAssignment(
          '_indexes',
          nodeMap({ names: table.indexes, nameKey: '_indexName' }),
        ),
        f.createPropertyAssignment(
          '_constraints',
          nodeMap({ names: table.constraints, nameKey: '_constraintName' }),
        ),
      ],
      true,
    );
  const literal = f.createObjectLiteralExpression(
    tables.map((table) => f.createPropertyAssignment(valuePropertyName(table.name), entry(table))),
    true,
  );
  const declaration = f.createVariableDeclaration(
    SCHEMA_VALUE,
    undefined,
    undefined,
    f.createAsExpression(literal, f.createTypeReferenceNode('const')),
  );
  return f.createVariableStatement(
    [exported()],
    f.createVariableDeclarationList([declaration], ts.NodeFlags.Const),
  );
}

// Pascal-casing table names isn't injective, so a base that's already taken gets a
// numeric suffix — two relations can't share an interface name.
const SUFFIX_START = 2;

function uniqueBases(tables: EmitTable[]): Map<string, string> {
  const used = new Set<string>();
  const bases = new Map<string, string>();
  for (const table of tables) {
    // A name of only separators (`"__"`) pascal-cases to nothing; `Table` keeps the
    // emitted identifier valid.
    const base = pascalCase(table.name) || 'Table';
    let unique = base;
    for (let n = SUFFIX_START; used.has(unique); n++) {
      unique = `${base}${n}`;
    }
    used.add(unique);
    bases.set(table.name, unique);
  }
  return bases;
}

/**
 * The schema block: per relation, an interface of its columns — typed by the same
 * pipeline the query results go through — and one naming that column type alongside
 * its index and constraint names, both collected into an exported `Tables` registry.
 * Empty when the schema block is turned off.
 */
export function schemaDeclarations(input: {
  tables: EmitTable[];
  schema: SchemaIndex;
}): ts.Statement[] {
  const { tables, schema } = input;
  if (tables.length === 0) {
    return [];
  }
  const statements: ts.Statement[] = [];

  for (const table of tables) {
    const base = schema.get(table.name)!.base;

    const columns = f.createInterfaceDeclaration(
      [exported()],
      columnsName(base),
      undefined,
      undefined,
      table.columns.map((field) => fieldSignature({ field })),
    );
    docComment({ node: columns, text: `Columns of \`${table.name}\`.` });
    statements.push(columns);

    const entry = f.createInterfaceDeclaration(
      [exported()],
      tableName(base),
      undefined,
      undefined,
      [
        f.createPropertySignature(
          undefined,
          'columns',
          undefined,
          f.createTypeReferenceNode(columnsName(base)),
        ),
        f.createPropertySignature(
          undefined,
          'relationType',
          undefined,
          schemaMember({ table: table.name, key: '_relationType' }),
        ),
        f.createPropertySignature(
          undefined,
          'indexes',
          undefined,
          namesUnion({ table: table.name, key: '_indexes' }),
        ),
        f.createPropertySignature(
          undefined,
          'constraints',
          undefined,
          namesUnion({ table: table.name, key: '_constraints' }),
        ),
      ],
    );
    docComment({ node: entry, text: `Schema of \`${table.name}\`.` });
    statements.push(entry);
  }

  statements.push(schemaValue(tables));
  statements.push(
    f.createInterfaceDeclaration(
      [exported()],
      TABLE_REGISTRY,
      undefined,
      undefined,
      tables.map((table) =>
        f.createPropertySignature(
          undefined,
          propertyName(table.name),
          undefined,
          f.createTypeReferenceNode(tableName(schema.get(table.name)!.base)),
        ),
      ),
    ),
  );
  return statements;
}

// `declare module '<package>' { interface QueryResults extends Queries {} … }` — merges
// each registry into the package's global counterpart, so `withTypes(sql)` (no explicit
// registry) stays typed for single-package use and `DatabaseTables` names the schema.
export function augmentation(input: {
  packageName: string;
  withSchema: boolean;
}): ts.ModuleDeclaration {
  const merge = (names: { global: string; local: string }): ts.InterfaceDeclaration =>
    f.createInterfaceDeclaration(
      undefined,
      names.global,
      undefined,
      [
        f.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
          f.createExpressionWithTypeArguments(f.createIdentifier(names.local), undefined),
        ]),
      ],
      [],
    );
  const registries = [merge({ global: GLOBAL_REGISTRY, local: REGISTRY })];
  if (input.withSchema) {
    registries.push(merge({ global: GLOBAL_TABLE_REGISTRY, local: TABLE_REGISTRY }));
  }
  return f.createModuleDeclaration(
    [f.createModifier(ts.SyntaxKind.DeclareKeyword)],
    f.createStringLiteral(input.packageName),
    f.createModuleBlock(registries),
  );
}
