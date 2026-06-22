import ts from 'typescript';
import { f, propertyName, resultName, typeNode } from '#emit/ast.ts';
import type { EmitModel, ResolvedField } from '#types.ts';

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

// The row interface backing one registry entry. Module-local (not exported): the
// public way to name a row type is `QueryResults['Name']`, so there is a single
// access path and no second importable surface to keep in sync.
export function resultInterface(q: EmitModel): ts.InterfaceDeclaration {
  const node = f.createInterfaceDeclaration(
    undefined,
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

// `declare module '<package>' { interface QueryResults { Foo: IFooResult; ... } }` —
// merges each query name→row into the package's registry, so `withTypes` types it.
export function augmentation(input: {
  queries: EmitModel[];
  packageName: string;
}): ts.ModuleDeclaration {
  const registry = f.createInterfaceDeclaration(
    undefined,
    'QueryResults',
    undefined,
    undefined,
    input.queries.map((q) =>
      f.createPropertySignature(
        undefined,
        propertyName(q.name),
        undefined,
        f.createTypeReferenceNode(resultName(q.name)),
      ),
    ),
  );
  return f.createModuleDeclaration(
    [f.createModifier(ts.SyntaxKind.DeclareKeyword)],
    f.createStringLiteral(input.packageName),
    f.createModuleBlock([registry]),
  );
}
