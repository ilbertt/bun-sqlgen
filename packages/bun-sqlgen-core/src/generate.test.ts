import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { type GenerateOptions, generate } from '#generate.ts';

const fixtures: string[] = [];
const QUERY_COUNT = 6;

afterEach(() => {
  for (const cwd of fixtures.splice(0)) {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function fixture(): GenerateOptions {
  const cwd = mkdtempSync(join(import.meta.dir, '.schemas-test-'));
  fixtures.push(cwd);
  mkdirSync(join(cwd, 'migrations'));
  writeFileSync(
    join(cwd, 'migrations/0001.sql'),
    `CREATE SCHEMA app;
     CREATE SCHEMA auth;
     CREATE TABLE auth.accounts (id text PRIMARY KEY, prefs jsonb NOT NULL);
     COMMENT ON COLUMN auth.accounts.prefs IS '@type { enabled: boolean }';
     CREATE TABLE app.items (
       id integer PRIMARY KEY,
       account_id text CONSTRAINT items_account_fk REFERENCES auth.accounts(id),
       label text NOT NULL
     );
     CREATE INDEX items_label_idx ON app.items(label);
     COMMENT ON COLUMN app.items.label IS 'Application label. @type "app"';
     CREATE TABLE auth.items (id text NOT NULL, label text);
     COMMENT ON COLUMN auth.items.label IS 'Auth label. @type "auth"';
     CREATE VIEW app.item_labels AS SELECT label FROM app.items;
     CREATE MATERIALIZED VIEW app.item_snapshot AS SELECT id FROM app.items;
     CREATE VIEW auth.item_labels AS SELECT label FROM auth.items;
     COMMENT ON COLUMN auth.item_labels.label IS '@type "auth-view"';
     CREATE TABLE public.unrelated (id integer NOT NULL);`,
  );
  writeFileSync(
    join(cwd, 'queries.ts'),
    `import { withTypes } from '@repo/bun-sqlgen';
     import { SQL } from 'bun';
     const sql = withTypes(new SQL('postgres://localhost/test'));
     sql.AppItems\`SELECT id, label FROM app.items\`;
     sql.AuthItems\`SELECT id, label FROM auth.items\`;
     sql.Accounts\`SELECT prefs FROM auth.accounts\`;
     sql.AppView\`SELECT label FROM app.item_labels\`;
     sql.AuthView\`SELECT label FROM auth.item_labels\`;
     sql.Joined\`SELECT a.label AS app_label, b.label AS auth_label
       FROM app.items a LEFT JOIN auth.items b ON b.id = a.account_id\`;`,
  );
  return {
    cwd,
    queries: 'queries.ts',
    migrations: 'migrations',
    out: 'queries.gen.ts',
    packageName: '@repo/bun-sqlgen',
  };
}

function resultTypes(options: GenerateOptions): Record<string, Record<string, string>> {
  const path = join(options.cwd!, options.out!);
  const imports = join(options.cwd!, 'typecheck.ts');
  writeFileSync(imports, "import '@repo/bun-sqlgen';\n");
  const program = ts.createProgram([path, imports], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    types: ['bun'],
    paths: {
      '@repo/bun-sqlgen': [resolve(import.meta.dir, '../../bun-sqlgen/src/index.ts')],
    },
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  ).toEqual([]);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(path)!;
  const results: Record<string, Record<string, string>> = {};
  for (const node of source.statements) {
    if (!ts.isInterfaceDeclaration(node) || !node.name.text.endsWith('Result')) {
      continue;
    }
    const type = checker.getTypeAtLocation(node);
    results[node.name.text] = Object.fromEntries(
      type
        .getProperties()
        .map((property) => [
          property.name,
          checker.typeToString(checker.getTypeOfSymbolAtLocation(property, node)),
        ]),
    );
  }
  return results;
}

async function runtimeSchema(
  options: GenerateOptions,
): Promise<Record<string, unknown> | undefined> {
  const module = await import(join(options.cwd!, options.out!));
  return module.schema;
}

test('filters exports before collapsing names and preserves excluded query types and foreign keys', async () => {
  const options = fixture();
  const filtered = { ...options, schemas: ['app'] };
  const result = await generate(filtered);
  expect(result.failures).toEqual([]);
  expect(result.typed).toBe(QUERY_COUNT);
  const schema = await runtimeSchema(filtered);
  expect(Object.keys(schema!)).toEqual(['item_labels', 'item_snapshot', 'items']);
  expect(schema).toMatchObject({
    items: {
      _columns: {
        id: { _columnName: 'id' },
        label: { _columnName: 'label' },
        account_id: {
          _foreignKeys: {
            items_account_fk: {
              _references: { _relationName: 'accounts', _columnName: 'id' },
            },
          },
        },
      },
      _indexes: { items_label_idx: { _indexName: 'items_label_idx' } },
      _constraints: { items_account_fk: { _constraintName: 'items_account_fk' } },
    },
    item_labels: { _relationType: 'view' },
    item_snapshot: { _relationType: 'materialized_view' },
  });
  const content = readFileSync(join(options.cwd!, options.out!), 'utf8');
  expect(content).toContain('export interface IItemsColumns');
  expect(content).not.toContain('export interface IAccountsColumns');
  const filteredTypes = resultTypes(filtered);
  expect(filteredTypes.IAppItemsResult).toEqual({ id: 'number', label: '"app"' });
  expect(filteredTypes.IAuthItemsResult).toEqual({ id: 'string', label: '"auth" | null' });
  expect(filteredTypes.IAccountsResult).toEqual({ prefs: '{ enabled: boolean; }' });
  expect(filteredTypes.IAuthViewResult).toEqual({ label: '"auth-view" | null' });
  expect(filteredTypes.IJoinedResult).toEqual({ app_label: '"app"', auth_label: '"auth" | null' });

  await generate({ ...options, out: 'all.gen.ts' });
  expect(Object.keys((await runtimeSchema({ ...options, out: 'all.gen.ts' }))!)).toEqual([
    'item_labels',
    'item_snapshot',
    'items',
    'accounts',
    'unrelated',
  ]);
  expect(resultTypes({ ...options, out: 'all.gen.ts' })).toEqual(filteredTypes);

  await generate({ ...filtered, schema: false, out: 'no-schema.gen.ts' });
  expect(await runtimeSchema({ ...options, out: 'no-schema.gen.ts' })).toBeUndefined();
  expect(resultTypes({ ...options, out: 'no-schema.gen.ts' })).toEqual(filteredTypes);
});

test('loads the config allowlist, allows explicit overrides, and checks stale output', async () => {
  const options = fixture();
  writeFileSync(join(options.cwd!, 'sqlgen.config.ts'), "export default { schemas: ['app'] };\n");
  await generate(options);
  expect(Object.keys((await runtimeSchema(options))!)).toEqual([
    'item_labels',
    'item_snapshot',
    'items',
  ]);
  expect((await generate({ ...options, checkStale: true })).changed).toBe(false);
  expect((await generate({ ...options, schemas: ['auth'], checkStale: true })).changed).toBe(true);
  await generate({ ...options, schemas: ['auth', 'public'], out: 'override.gen.ts' });
  expect(Object.keys((await runtimeSchema({ ...options, out: 'override.gen.ts' }))!)).toEqual([
    'accounts',
    'item_labels',
    'items',
    'unrelated',
  ]);
  for (const schemas of [[], ['missing'], ['APP']]) {
    const empty = { ...options, schemas, out: `empty-${schemas.join('-')}.gen.ts` };
    expect((await generate(empty)).failures).toEqual([]);
    expect(await runtimeSchema(empty)).toBeUndefined();
    expect(readFileSync(join(empty.cwd!, empty.out), 'utf8')).not.toContain(
      'export interface Tables',
    );
  }
});

test('validates queries against excluded schemas and keeps check mode read-only', async () => {
  const options = fixture();
  const filtered = { ...options, schemas: ['app'], checkQueries: true };
  expect((await generate(filtered)).failures).toEqual([]);
  expect(existsSync(join(options.cwd!, options.out!))).toBe(false);
  writeFileSync(
    join(options.cwd!, 'queries.ts'),
    `import { withTypes } from '@repo/bun-sqlgen';
     import { SQL } from 'bun';
     const sql = withTypes(new SQL('postgres://localhost/test'));
     sql.InvalidAuth\`SELECT missing FROM auth.accounts\`;`,
  );
  const result = await generate(filtered);
  expect(result.failures.map((failure) => failure.name)).toEqual(['InvalidAuth']);
  expect(result.failures[0]!.error).toContain('column "missing" does not exist');
});

test('rejects a PostgreSQL schema allowlist when SQLite is selected', async () => {
  await expect(generate({ ...fixture(), dialect: 'sqlite', schemas: ['app'] })).rejects.toThrow(
    'schemas is only supported for the postgres dialect',
  );
});

async function cli(input: { options: GenerateOptions; args: string[] }): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, '../../bun-sqlgen/src/cli/main.ts'),
      'generate',
      'queries.ts',
      '--migrations',
      'migrations',
      '--out',
      input.options.out!,
      '--package',
      '@repo/bun-sqlgen',
      ...input.args,
    ],
    { cwd: input.options.cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test('CLI allowlist overrides config, yields to --no-schema, and rejects SQLite', async () => {
  const options = fixture();
  writeFileSync(join(options.cwd!, 'sqlgen.config.ts'), "export default { schemas: ['app'] };\n");
  expect((await cli({ options, args: ['--schemas', 'auth, public'] })).exitCode).toBe(0);
  expect(Object.keys((await runtimeSchema(options))!)).toEqual([
    'accounts',
    'item_labels',
    'items',
    'unrelated',
  ]);
  const disabled = { ...options, out: 'disabled.gen.ts' };
  expect(
    (await cli({ options: disabled, args: ['--schemas', 'app', '--no-schema'] })).exitCode,
  ).toBe(0);
  expect(await runtimeSchema(disabled)).toBeUndefined();
  const sqlite = await cli({ options, args: ['--dialect', 'sqlite', '--schemas', 'app'] });
  expect(sqlite.exitCode).toBe(1);
  expect(sqlite.stderr).toContain('schemas is only supported for the postgres dialect');
  expect((await cli({ options, args: ['--schemas', 'app,,public'] })).exitCode).not.toBe(0);
});

test('an empty selection removes a previously generated schema without named queries', async () => {
  const options = fixture();
  writeFileSync(join(options.cwd!, 'queries.ts'), 'export {};\n');
  await generate(options);
  expect(readFileSync(join(options.cwd!, options.out!), 'utf8')).toContain(
    'export interface Tables',
  );
  expect((await generate({ ...options, schemas: [], checkStale: true })).changed).toBe(true);
  await generate({ ...options, schemas: [] });
  expect(readFileSync(join(options.cwd!, options.out!), 'utf8')).not.toContain(
    'export interface Tables',
  );
  expect((await generate({ ...options, schemas: [], checkStale: true })).changed).toBe(false);
});
