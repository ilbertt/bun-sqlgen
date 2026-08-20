import ts from '@typescript/typescript6';

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

// `deal_meta` -> `DealMeta`, the base for a relation's interface names. Table names are
// free-form, so this isn't injective (`deal_meta` and `dealMeta` collapse together) —
// callers pass the result through `uniqueBases` before naming anything.
export const pascalCase = (name: string): string =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(cap)
    .join('');

// The exported interface names for a relation's columns and its schema entry, both
// built from a base already made unique across the schema.
export const columnsName = (base: string): string => `I${base}Columns`;
export const tableName = (base: string): string => `I${base}Table`;

const VALID_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function propertyName(name: string): ts.PropertyName {
  return VALID_IDENTIFIER.test(name) ? f.createIdentifier(name) : f.createStringLiteral(name);
}

// The same, for a key in an object *literal*. `__proto__` there is the prototype-setter
// form — as a plain or string key it produces no own property at all, so the emitted
// `as const` type would claim a relation the runtime object doesn't have. A computed key
// is an ordinary assignment and keeps the literal type.
export function valuePropertyName(name: string): ts.PropertyName {
  return name === '__proto__'
    ? f.createComputedPropertyName(f.createStringLiteral(name))
    : propertyName(name);
}

// Parse an arbitrary TS type (`'a' | 'b'`, `string[]`, `{ p: number }`) into a real
// TypeNode, so the printer reproduces it verbatim and validates its syntax.
export function typeNode(text: string): ts.TypeNode {
  const sf = ts.createSourceFile('__t.ts', `type __=${text};`, ts.ScriptTarget.Latest, false);
  return (sf.statements[0] as ts.TypeAliasDeclaration).type;
}
