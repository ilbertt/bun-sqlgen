import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { generate } from '#generate.ts';

const TEST_TIMEOUT_MS = 30_000;

function resultTypes(input: { cwd: string; out: string }): Record<string, Record<string, string>> {
  const path = join(input.cwd, input.out);
  const program = ts.createProgram([path, join(input.cwd, 'queries.ts')], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    types: ['bun'],
    paths: { '@repo/bun-sqlgen': [resolve(import.meta.dir, '../../bun-sqlgen/src/index.ts')] },
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  ).toEqual([]);
  const checker = program.getTypeChecker();
  const results: Record<string, Record<string, string>> = {};
  for (const node of program.getSourceFile(path)!.statements) {
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Result')) {
      results[node.name.text] = Object.fromEntries(
        node.members
          .filter(ts.isPropertySignature)
          .map((field) => [
            field.name.getText(),
            checker.typeToString(checker.getTypeAtLocation(field)),
          ]),
      );
    }
  }
  return results;
}

test(
  'schema filtering preserves cross-schema foreign keys and query types',
  async () => {
    const cwd = mkdtempSync(join(import.meta.dir, '.db-schemas-test-'));
    const options = {
      cwd,
      queries: 'queries.ts',
      migrations: 'migrations',
      packageName: '@repo/bun-sqlgen',
    };
    try {
      mkdirSync(join(cwd, 'migrations'));
      writeFileSync(
        join(cwd, 'migrations/0001.sql'),
        `
      CREATE SCHEMA app;
      CREATE SCHEMA auth;
      CREATE TABLE auth.items (id text PRIMARY KEY, label text);
      CREATE TABLE app.items (
        id integer PRIMARY KEY,
        owner_id text CONSTRAINT owner_fk REFERENCES auth.items(id),
        label text NOT NULL
      );
      COMMENT ON COLUMN app.items.label IS '@type "app"';
      COMMENT ON COLUMN auth.items.label IS '@type "auth"';
      CREATE VIEW app.labels AS SELECT label FROM app.items;
      CREATE VIEW auth.labels AS SELECT label FROM auth.items;
      COMMENT ON COLUMN auth.labels.label IS '@type "auth-view"';
      CREATE MATERIALIZED VIEW app.snapshot AS SELECT id FROM app.items;
    `,
      );
      const queries = `import { SQL } from 'bun';
      import { withTypes } from '@repo/bun-sqlgen';
      const sql = withTypes(new SQL('postgres://localhost/test'));
      sql.Included\`SELECT id, label FROM app.items\`;
      sql.Excluded\`SELECT id, label FROM auth.items\`;
      sql.ExcludedView\`SELECT label FROM auth.labels\`;
      sql.Joined\`SELECT a.id AS app_id, b.id AS auth_id
        FROM app.items a LEFT JOIN auth.items b ON b.id = a.owner_id\`;`;
      writeFileSync(join(cwd, 'queries.ts'), queries);
      writeFileSync(join(cwd, 'sqlgen.config.ts'), "export default { dbSchemas: ['app'] };\n");
      const filtered = { ...options, out: 'filtered.gen.ts' };
      expect((await generate(filtered)).failures).toEqual([]);
      const { schema } = await import(join(cwd, filtered.out));
      expect(Object.keys(schema)).toEqual(['items', 'labels', 'snapshot']);
      expect(schema.items._columns.owner_id._foreignKeys.owner_fk._references).toEqual({
        _relationName: 'items',
        _columnName: 'id',
      });
      expect(schema.labels._relationType).toBe('view');
      expect(schema.snapshot._relationType).toBe('materialized_view');
      const expected = {
        IIncludedResult: { id: 'number', label: '"app"' },
        IExcludedResult: { id: 'string', label: '"auth" | null' },
        IExcludedViewResult: { label: '"auth-view" | null' },
        IJoinedResult: { app_id: 'number', auth_id: 'string | null' },
      };
      expect(resultTypes(filtered)).toEqual(expected);
      for (const settings of [
        { out: 'all.gen.ts', config: {} },
        { out: 'none.gen.ts', config: { dbSchemas: [] } },
        { out: 'disabled.gen.ts', config: { dbSchemas: ['app'], schema: false } },
      ]) {
        const configPath = join(cwd, `${settings.out}.config.ts`);
        writeFileSync(configPath, `export default ${JSON.stringify(settings.config)};\n`);
        await generate({ ...options, out: settings.out, configPath });
        expect(resultTypes({ cwd, out: settings.out })).toEqual(expected);
      }
      for (const disabled of [false, true]) {
        const out = `cli-${disabled}.gen.ts`;
        const cli = Bun.spawn(
          [
            process.execPath,
            resolve(import.meta.dir, '../../bun-sqlgen/src/cli/main.ts'),
            'generate',
            'queries.ts',
            '--migrations',
            'migrations',
            '--out',
            out,
            '--package',
            '@repo/bun-sqlgen',
            '--db-schemas',
            'auth',
            ...(disabled ? ['--no-schema'] : []),
          ],
          { cwd, stdout: 'ignore', stderr: 'inherit' },
        );
        expect(await cli.exited).toBe(0);
        const { schema } = await import(join(cwd, out));
        expect(schema && Object.keys(schema)).toEqual(disabled ? undefined : ['items', 'labels']);
      }
      writeFileSync(
        join(cwd, 'queries.ts'),
        `${queries}\nsql.Invalid\`SELECT missing FROM auth.items\`;`,
      );
      expect(
        (await generate({ ...filtered, checkQueries: true })).failures.map((f) => f.name),
      ).toEqual(['Invalid']);
      await expect(generate({ ...filtered, dialect: 'sqlite' })).rejects.toThrow(
        'dbSchemas is only supported for the postgres dialect',
      );
      writeFileSync(join(cwd, 'queries.ts'), 'export {};\n');
      await generate({ ...filtered, configPath: join(cwd, 'none.gen.ts.config.ts') });
      expect(readFileSync(join(cwd, filtered.out), 'utf8')).not.toContain(
        'export interface Tables',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
