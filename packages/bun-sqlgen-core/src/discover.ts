import type { ReservedSQL, SavepointSQL, SQL, TransactionSQL } from 'bun';
import ts from 'typescript';
import type { Dialect, DiscoveredQuery, WritableColumns } from '#types.ts';

// Positional bind placeholder for the dialect: Postgres `$n`, SQLite `?n`. Both
// number from 1 and match how Bun flattens params left-to-right at runtime.
function placeholderFor(dialect: Dialect): (n: number) => string {
  return dialect === 'sqlite' ? (n) => `?${n}` : (n) => `$${n}`;
}

/**
 * Finds Bun.sql tagged templates via the TS AST and turns each into static,
 * describable SQL. Composition is the hard part: a `${expr}` resolving to another
 * `sql\`...\`` fragment is inlined recursively; everything else becomes a
 * positional placeholder (`$n` for Postgres, `?n` for SQLite). One shared counter
 * walks left-to-right, matching how Bun flattens params at runtime. Tag detection
 * is semantic — the checker confirms a
 * tag's type is Bun's `SQL` (or our `withTypes` wrapper, an intersection over it)
 * — so aliases/re-exports/`Bun.sql`/wrapped clients all resolve.
 *
 * A query is a named tag — `sql.MyQuery\`...\`` — taking its name from the property.
 * A bare `sql\`...\`` is a composable fragment, not a query.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: ['bun'],
  skipLibCheck: true,
  noEmit: true,
  allowJs: true,
};

export type Discoverer = (file: string) => DiscoveredQuery[];

/**
 * One program/checker for the whole project, honoring its tsconfig (module
 * resolution, `paths`, `#subpath` imports) so `sql` tags resolve to Bun's `SQL`
 * type wherever they come from.
 */
export function createDiscoverer(input: {
  projectRoot: string;
  files: string[];
  writable?: WritableColumns;
  dialect?: Dialect;
}): Discoverer {
  const { projectRoot, files, writable = {}, dialect = 'postgres' } = input;
  const placeholder = placeholderFor(dialect);
  let options = COMPILER_OPTIONS;
  let rootFiles = files;

  const cfgPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (cfgPath) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      cfgPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (parsed) {
      options = { ...parsed.options, noEmit: true };
      rootFiles = [...new Set([...parsed.fileNames, ...files])];
    }
  }

  const program = ts.createProgram(rootFiles, options);
  const checker = program.getTypeChecker();
  return (file) => {
    const sf = program.getSourceFile(file);
    return sf ? discover({ sf, checker, writable, placeholder }) : [];
  };
}

interface DiscoverCtx {
  symbols: Map<string, ts.Expression>;
  paramCount: number;
  visiting: Set<string>;
  isFragmentInit: (node: ts.Expression | undefined) => boolean;
  checker: ts.TypeChecker;
  writable: WritableColumns;
  placeholder: (n: number) => string;
  neutralized?: boolean;
}

function discover(input: {
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
  writable: WritableColumns;
  placeholder: (n: number) => string;
}): DiscoveredQuery[] {
  const { sf, checker, writable, placeholder } = input;
  const isSql = (node: ts.Node): node is ts.TaggedTemplateExpression =>
    ts.isTaggedTemplateExpression(node) && isBunSqlType({ expr: node.tag, checker });
  const isFragmentInit = (node: ts.Expression | undefined): boolean => !!node && isSql(node);

  // `const NAME = <init>` -> init, for inlining fragments. Last write wins (no scope analysis).
  const symbols = new Map<string, ts.Expression>();
  (function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      symbols.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  })(sf);

  // Identifiers/fields bound to a typed-SQL client, so `sql.Name\`...\`` is found on
  // the very first run too — before the generated module exists and the checker can
  // see the wrapper type.
  const bindings = collectTypedSqlBindings({ sf, checker });

  // A query is a named tag, `sql.Name\`...\``; its name is the property. A bare
  // `sql\`...\`` (no property) is a composable fragment, not a query.
  const found: Array<{ node: ts.TaggedTemplateExpression; name: string }> = [];
  (function scan(node: ts.Node): void {
    if (ts.isTaggedTemplateExpression(node)) {
      const name = namedTag({ node, checker, bindings });
      if (name) {
        found.push({ node, name });
      }
    }
    ts.forEachChild(node, scan);
  })(sf);

  const out: DiscoveredQuery[] = [];
  for (const { node, name } of found) {
    const ctx: DiscoverCtx = {
      symbols,
      paramCount: 0,
      visiting: new Set(),
      isFragmentInit,
      checker,
      writable,
      placeholder,
    };
    const sql = expand({ tpl: node.template, ctx });
    out.push({
      name,
      sql,
      paramCount: ctx.paramCount,
      neutralized: !!ctx.neutralized,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    });
  }
  return out;
}

interface TypedSqlBindings {
  vars: Set<string>;
  fields: Set<string>;
}

// `sql.MyQuery\`...\``: a property-access tag whose object is a typed-SQL client and
// whose property isn't a real Bun `SQL` member (so `sql.begin\`...\`` is left alone).
function namedTag(input: {
  node: ts.TaggedTemplateExpression;
  checker: ts.TypeChecker;
  bindings: TypedSqlBindings;
}): string | null {
  const { node, checker, bindings } = input;
  const tag = node.tag;
  if (!ts.isPropertyAccessExpression(tag) || !ts.isIdentifier(tag.name)) {
    return null;
  }
  const obj = tag.expression;
  if (
    !isTypedSqlObject({ obj, checker, bindings }) ||
    isBunSqlMember({ obj, name: tag.name.text, checker })
  ) {
    return null;
  }
  return tag.name.text;
}

// Is `obj` a typed-SQL client — by type (steady state) or by a tracked binding
// (first run, before the wrapper type resolves)?
function isTypedSqlObject(input: {
  obj: ts.Expression;
  checker: ts.TypeChecker;
  bindings: TypedSqlBindings;
}): boolean {
  const { obj, checker, bindings } = input;
  if (isBunSqlType({ expr: obj, checker })) {
    return true;
  }
  if (ts.isIdentifier(obj)) {
    return bindings.vars.has(obj.text);
  }
  if (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.name)) {
    return bindings.fields.has(obj.name.text);
  }
  return false;
}

// True when `name` resolves to a property declared by Bun's `SQL` type (a real
// method like `begin`), so it's never a generated query name.
function isBunSqlMember(input: {
  obj: ts.Expression;
  name: string;
  checker: ts.TypeChecker;
}): boolean {
  const type = input.checker.getTypeAtLocation(input.obj);
  const prop = type.getProperty?.(input.name);
  return (prop?.getDeclarations() ?? []).some((d) => isBunSqlFile(d.getSourceFile().fileName));
}

// Collect identifiers/class fields that hold a typed-SQL client: `withTypes(...)`,
// `new SQL(...)`, or a field annotated with the `TypedSQL` wrapper type.
function collectTypedSqlBindings(input: {
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
}): TypedSqlBindings {
  const { sf, checker } = input;
  const vars = new Set<string>();
  const fields = new Set<string>();
  const isInit = (e: ts.Expression | undefined): boolean =>
    !!e && isTypedSqlInit({ expr: e, checker });
  (function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isInit(node.initializer)) {
      vars.add(node.name.text);
    } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isInit(node.initializer) || (node.type && mentionsTypedSql(node.type))) {
        fields.add(node.name.text);
      }
    } else if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      mentionsTypedSql(node.type)
    ) {
      fields.add(node.name.text);
    } else if (isThisAssignment(node) && isInit(node.right)) {
      fields.add(node.left.name.text);
    }
    ts.forEachChild(node, walk);
  })(sf);
  return { vars, fields };
}

function isThisAssignment(
  node: ts.Node,
): node is ts.BinaryExpression & { left: ts.PropertyAccessExpression & { name: ts.Identifier } } {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(node.left.name)
  );
}

// `withTypes(...)` or `new SQL(...)` — what a typed-SQL client is constructed from.
function isTypedSqlInit(input: { expr: ts.Expression; checker: ts.TypeChecker }): boolean {
  const { expr, checker } = input;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text === 'withTypes';
  }
  if (ts.isNewExpression(expr)) {
    return isBunSqlType({ expr: expr.expression, checker });
  }
  return false;
}

function mentionsTypedSql(typeNode: ts.TypeNode): boolean {
  return /\bTypedSQL\b/.test(typeNode.getText());
}

// Render a template to static SQL, threading the param counter and SQL-so-far
// (so neutralization can read the preceding keyword).
function expand(input: { tpl: ts.TemplateLiteral; ctx: DiscoverCtx }): string {
  const { tpl, ctx } = input;
  if (ts.isNoSubstitutionTemplateLiteral(tpl)) {
    return tpl.text;
  }
  let sql = tpl.head.text;
  for (const span of tpl.templateSpans) {
    sql += resolveInterpolation({ expr: span.expression, ctx, sqlSoFar: sql }) + span.literal.text;
  }
  return sql;
}

// What a single `${expr}` becomes: inlined fragment/identifier, a positional `$n`,
// or a neutral no-op for a fragment we can't statically trace.
function resolveInterpolation(input: {
  expr: ts.Expression;
  ctx: DiscoverCtx;
  sqlSoFar: string;
}): string {
  const { expr, ctx, sqlSoFar } = input;
  // `${someFragment}` — an identifier bound to a sql`...` fragment: inline it.
  if (ts.isIdentifier(expr)) {
    const init = ctx.symbols.get(expr.text);
    if (ctx.isFragmentInit(init)) {
      if (ctx.visiting.has(expr.text)) {
        throw new Error(`cyclic sql fragment: ${expr.text}`);
      }
      ctx.visiting.add(expr.text);
      const sql = expand({ tpl: (init as ts.TaggedTemplateExpression).template, ctx });
      ctx.visiting.delete(expr.text);
      return sql;
    }
    // `${tableName}` where `const tableName = sql("deals")` — identifier escape.
    if (init && isIdentifierCall({ node: init, checker: ctx.checker })) {
      return identifierOf(init);
    }
  }
  // Inline `${sql("deals")}` written directly at the call site.
  if (isIdentifierCall({ node: expr, checker: ctx.checker })) {
    return identifierOf(expr);
  }

  // An untraceable sql fragment (ternary, reduce, array element...). It only
  // filters/orders, never changes columns, so neutralize it rather than fail.
  if (isSqlCompositionType({ expr, checker: ctx.checker })) {
    ctx.neutralized = true;
    return neutralToken({ sqlSoFar, ctx });
  }

  // A runtime value -> bind parameter.
  ctx.paramCount += 1;
  return ctx.placeholder(ctx.paramCount);
}

const KEYWORD_BOUNDARY = /\b(where|and|or|on|having|not)$/;
const IN_BOUNDARY = /\bin$/;
const BY_BOUNDARY = /\bby$/;
const SET_BOUNDARY = /\bset$/;
const SELECT_LIST_BOUNDARY = /(\bselect|,)$/;
const UPDATE_TARGET = /update\s+(?:"?\w+"?\.)?"?(\w+)"?\s+set$/i;

// A no-op chosen from the preceding keyword. Must keep the SQL valid AND the scan
// in the plan — a constant-FALSE predicate would let the planner prune the scan
// we read provenance from — so we use always-true / plan-opaque tokens.
function neutralToken(input: { sqlSoFar: string; ctx: DiscoverCtx }): string {
  const { sqlSoFar, ctx } = input;
  const tail = sqlSoFar.replace(/\s+$/, '').toLowerCase();
  if (KEYWORD_BOUNDARY.test(tail)) {
    return 'TRUE';
  }
  if (IN_BOUNDARY.test(tail)) {
    ctx.paramCount += 1;
    return `(${ctx.placeholder(ctx.paramCount)})`;
  }
  if (BY_BOUNDARY.test(tail)) {
    return '1';
  }
  // `UPDATE t SET ${dynamic}`: SET is required, so self-assign a real column.
  if (SET_BOUNDARY.test(tail)) {
    const col = setSelfAssign({ sqlSoFar, writable: ctx.writable });
    if (col) {
      return col;
    }
  }
  // SELECT-list: keep the column as NULL so the row shape is preserved (drop the
  // `sql.Name` tag and hand-type the query if the real column type matters).
  if (SELECT_LIST_BOUNDARY.test(tail)) {
    return 'NULL';
  }
  return '';
}

// `"col" = "col"` for a writable column of the UPDATE target, or null.
function setSelfAssign(input: { sqlSoFar: string; writable: WritableColumns }): string | null {
  const m = UPDATE_TARGET.exec(input.sqlSoFar.replace(/\s+$/, ''));
  const col = m && input.writable[m[1]!]?.[0];
  return col ? `"${col}" = "${col}"` : null;
}

// True when the expression's type comes from Bun's SQL definitions — a composed
// fragment, not a scalar bind value.
function isSqlCompositionType(input: { expr: ts.Expression; checker: ts.TypeChecker }): boolean {
  const type = input.checker.getTypeAtLocation(input.expr);
  const sym = type.getSymbol() ?? type.aliasSymbol;
  return (sym?.getDeclarations() ?? []).some((d) => {
    const f = d.getSourceFile().fileName;
    return f.includes('bun-types') && /sql/i.test(f);
  });
}

// `sql("ident")` — Bun's identifier escape with a literal name.
function isIdentifierCall(input: {
  node: ts.Expression;
  checker: ts.TypeChecker;
}): input is { node: ts.CallExpression; checker: ts.TypeChecker } {
  const { node, checker } = input;
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]!) &&
    isBunSqlType({ expr: node.expression, checker })
  );
}

function identifierOf(call: ts.Expression): string {
  const arg = (call as ts.CallExpression).arguments[0];
  return (arg as ts.StringLiteralLike).text;
}

function isBunSqlFile(fileName: string): boolean {
  return fileName.includes('bun-types') || fileName.includes('@types/bun');
}

// Bun's family of SQL client types — the top-level client plus the scoped clients
// handed to a `begin`/`savepoint`/`reserve` callback. A `tx.Name\`...\`` inside a
// transaction is just as much a query as a top-level `sql.Name\`...\``. They're
// matched by interface name against the user program's symbols, so the strings must
// be Bun's exact names: `satisfies (keyof BunSqlClients)[]` rejects a mistyped entry,
// and `BunSqlClients` references each type so a bun-types rename/removal fails to
// compile. (TS can't reflect a type to its name string, so a name changing *value*
// while keeping its shape is the only drift this can't catch.)
interface BunSqlClients {
  SQL: SQL;
  TransactionSQL: TransactionSQL;
  SavepointSQL: SavepointSQL;
  ReservedSQL: ReservedSQL;
}
const BUN_SQL_TYPES: ReadonlySet<string> = new Set([
  'SQL',
  'TransactionSQL',
  'SavepointSQL',
  'ReservedSQL',
] satisfies (keyof BunSqlClients)[]);

// Does this expression carry a Bun SQL client type (its declaring symbol is one of
// the SQL family from bun-types/@types/bun)? Robust to how the tag was
// imported/aliased/re-exported, and to our `withTypes` wrapper and typed transaction
// client, whose types are intersections over those.
function isBunSqlType(input: { expr: ts.Expression; checker: ts.TypeChecker }): boolean {
  return typeIsBunSql(input.checker.getTypeAtLocation(input.expr));
}

function typeIsBunSql(type: ts.Type): boolean {
  const sym = type.getSymbol() ?? type.aliasSymbol;
  if (
    sym &&
    BUN_SQL_TYPES.has(sym.getName()) &&
    (sym.getDeclarations() ?? []).some((d) => isBunSqlFile(d.getSourceFile().fileName))
  ) {
    return true;
  }
  return type.isIntersection() && type.types.some(typeIsBunSql);
}
