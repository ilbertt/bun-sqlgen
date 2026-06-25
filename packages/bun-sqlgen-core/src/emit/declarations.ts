import ts from 'typescript';
import { f, propertyName, resultName, typeNode } from '#emit/ast.ts';
import type { EmitModel, ResolvedField } from '#types.ts';

// The registry interfaces the generated module emits; names must match what
// `@ilbertt/bun-sqlgen` declares. `REGISTRY` is the exported, importable registry;
// `GLOBAL_REGISTRY` is the package's ambient interface it merges into.
const REGISTRY = 'Queries';
const GLOBAL_REGISTRY = 'QueryResults';

function exported(): ts.Modifier {
  return f.createModifier(ts.SyntaxKind.ExportKeyword);
}

function fieldSignature(field: ResolvedField): ts.PropertySignature {
  const type = typeNode(field.nullable ? `${field.ts} | null` : field.ts);
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
export function resultInterface(q: EmitModel): ts.InterfaceDeclaration {
  const node = f.createInterfaceDeclaration(
    [exported()],
    resultName(q.name),
    undefined,
    undefined,
    q.resultFields.map(fieldSignature),
  );
  ts.addSyntheticLeadingComment(
    node,
    ts.SyntaxKind.MultiLineCommentTrivia,
    `* Result of query \`${q.name}\`. `,
    true,
  );
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

// `declare module '<package>' { interface QueryResults extends Queries {} }` — merges
// the registry into the package's global `QueryResults`, so `withTypes(sql)` (no
// explicit registry) stays typed for single-package use.
export function augmentation(input: { packageName: string }): ts.ModuleDeclaration {
  const registry = f.createInterfaceDeclaration(
    undefined,
    GLOBAL_REGISTRY,
    undefined,
    [
      f.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
        f.createExpressionWithTypeArguments(f.createIdentifier(REGISTRY), undefined),
      ]),
    ],
    [],
  );
  return f.createModuleDeclaration(
    [f.createModifier(ts.SyntaxKind.DeclareKeyword)],
    f.createStringLiteral(input.packageName),
    f.createModuleBlock([registry]),
  );
}
