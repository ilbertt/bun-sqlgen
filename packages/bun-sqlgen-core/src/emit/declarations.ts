import ts from 'typescript';
import { f, propertyName, resultName, typeNode } from '#emit/ast.ts';
import type { EmitModel, ResolvedField } from '#types.ts';

function fieldSignature(field: ResolvedField): ts.PropertySignature {
  const type = typeNode(field.nullable ? `${field.ts} | null` : field.ts);
  const sig = f.createPropertySignature(undefined, propertyName(field.name), undefined, type);
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

export function resultInterface(q: EmitModel): ts.InterfaceDeclaration {
  const node = f.createInterfaceDeclaration(
    [f.createModifier(ts.SyntaxKind.ExportKeyword)],
    resultName(q.name),
    undefined,
    undefined,
    q.resultFields.map(fieldSignature),
  );
  if (q.explicit) {
    ts.addSyntheticLeadingComment(
      node,
      ts.SyntaxKind.MultiLineCommentTrivia,
      `* Result of query \`${q.name}\`. `,
      true,
    );
  }
  if (q.neutralized) {
    for (const line of [
      ' NOTE: dynamic clauses (composed fragments) were neutralized for typing;',
      ' the row shape is unaffected, but verify no dynamic SELECT columns were dropped.',
    ]) {
      ts.addSyntheticLeadingComment(node, ts.SyntaxKind.SingleLineCommentTrivia, line, true);
    }
  }
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
