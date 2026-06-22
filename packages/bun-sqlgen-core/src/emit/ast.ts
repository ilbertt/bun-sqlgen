import ts from 'typescript';

// Shared factory + printer. Everything in the generated module is built as AST and
// run through one printer, so output is valid by construction (escaping, quoting,
// formatting handled) rather than assembled from strings.
export const f = ts.factory;

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const PRINT_FILE = ts.createSourceFile('queries.gen.ts', '', ts.ScriptTarget.Latest, false);

export function printNode(node: ts.Node): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, PRINT_FILE);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// The exported interface name for a query's row (also the registry value type).
export const resultName = (name: string): string => `I${cap(name)}Result`;

const VALID_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function propertyName(name: string): ts.PropertyName {
  return VALID_IDENTIFIER.test(name) ? f.createIdentifier(name) : f.createStringLiteral(name);
}

// Parse an arbitrary TS type (`'a' | 'b'`, `string[]`, `{ p: number }`) into a real
// TypeNode, so the printer reproduces it verbatim and validates its syntax.
export function typeNode(text: string): ts.TypeNode {
  const sf = ts.createSourceFile('__t.ts', `type __=${text};`, ts.ScriptTarget.Latest, false);
  return (sf.statements[0] as ts.TypeAliasDeclaration).type;
}
