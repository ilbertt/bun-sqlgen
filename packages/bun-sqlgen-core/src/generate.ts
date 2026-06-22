import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiscoverer } from '#discover.ts';
import { emitModule } from '#emit/index.ts';
import { createIntrospector } from '#introspect/index.ts';
import { parseColumnComments, parseOverrides, resolveFields } from '#nullability.ts';
import type { Dialect, DiscoveredQuery, EmitModel, SqlgenConfig } from '#types.ts';

// Where the aggregated module lands when `--out` is omitted.
const DEFAULT_OUT = 'src/queries.gen.d.ts';

// The package whose `QueryResults` registry the generated `declare module` augments.
// Real users import `withTypes` from here; override with `--package` (e.g. a workspace alias).
const DEFAULT_PACKAGE = '@ilbertt/bun-sqlgen';

// Our own output, never fed back in as a query source: the aggregated module
// (`*.gen.ts`) and any legacy per-file siblings (`*.gen.d.ts`).
const isGenerated = (f: string): boolean => f.endsWith('.gen.ts') || f.endsWith('.gen.d.ts');

export interface GenerateOptions {
  /** Glob(s) for query source files, e.g. `src/**\/*.ts`. Relative to `cwd`. */
  queries: string | string[];
  /** Migrations directory, relative to `cwd`. */
  migrations: string;
  /** Fail (don't write) if any generated file would change — the CI analog. */
  check?: boolean;
  /** Explicit path to `sqlgen.config.{ts,js,mjs}`; auto-discovered otherwise. */
  configPath?: string;
  /** Output path for the aggregated module, relative to `cwd`. Defaults to `src/queries.gen.d.ts`. */
  out?: string;
  /** Package whose `QueryResults` registry to augment. Defaults to `@ilbertt/bun-sqlgen`. */
  packageName?: string;
  /** Base directory for globs, migrations, and tsconfig lookup. Defaults to cwd. */
  cwd?: string;
  /** Database engine to introspect against. Overrides config; defaults to `postgres`. */
  dialect?: Dialect;
}

export interface GenerateFailure {
  name: string;
  file: string;
  line: number;
  error: string;
  sql: string;
}

export interface GenerateResult {
  typed: number;
  skipped: number;
  failures: GenerateFailure[];
  changed: boolean;
}

const SQL_PREVIEW_LONG = 90;
const SQL_PREVIEW_SHORT = 70;

/**
 * The `sqlx prepare` analog: discover `sql<Row[]>` tags -> describe against
 * PGlite -> resolve types/nullability -> write `<base>.gen.d.ts` siblings. Source
 * files are never touched; you import the generated `IFooResult` types yourself.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const check = options.check ?? false;

  // Explicit options win over config values.
  const config = await loadConfig({ root: cwd, explicit: options.configPath });

  const migrationsDir = resolve(cwd, options.migrations);
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT);

  // Resolve the query globs; skip our own generated output (the aggregated module
  // and any legacy per-file siblings).
  const globs = Array.isArray(options.queries) ? options.queries : [options.queries];
  const matched = new Set<string>();
  for (const pattern of globs) {
    for (const f of new Bun.Glob(pattern).scanSync({ cwd, absolute: true, onlyFiles: true })) {
      matched.add(f);
    }
  }
  const sourceFiles = [...matched].filter((f) => f !== outPath && !isGenerated(f));

  // Explicit `--dialect` wins over config; default Postgres. Extensions are a
  // PGlite (Postgres) concept; a SQLite config carries none.
  const dialect = options.dialect ?? config.dialect ?? 'postgres';
  const intro = await createIntrospector({
    dialect,
    migrationsDir,
    prelude: config.prelude,
    transformMigration: config.transformMigration,
    extensions: config.dialect === 'sqlite' ? undefined : config.extensions,
  });
  const catalog = await intro.catalog();
  const columnOverrides = parseColumnComments(await intro.columnComments());
  const writable = await intro.writableColumns();

  // `writable` lets SET-clause neutralization self-assign a real column.
  const discover = createDiscoverer({ projectRoot: cwd, files: sourceFiles, writable, dialect });

  const failures: GenerateFailure[] = [];
  let skipped = 0;

  // All queries feed one aggregated registry, so names must be unique project-wide.
  const discovered: Array<{ q: DiscoveredQuery; file: string }> = [];
  for (const file of sourceFiles) {
    for (const q of discover(file)) {
      if (q.skip) {
        skipped++;
      } else {
        discovered.push({ q, file });
      }
    }
  }
  requireUniqueNames(discovered);

  const emitModels: EmitModel[] = [];
  try {
    for (const { q, file } of discovered) {
      let described: Awaited<ReturnType<typeof intro.describe>>;
      try {
        described = await intro.describe(q.sql);
      } catch (e) {
        failures.push({
          name: q.name,
          file: basename(file),
          line: q.line,
          error: firstLine(e),
          sql: q.sql,
        });
        continue; // type what we can; report the rest in the summary
      }
      const overrides = parseOverrides(q.sql);
      const resultFields = resolveFields({ described, catalog, overrides, columnOverrides });
      emitModels.push({
        name: q.name,
        resultFields,
        neutralized: q.neutralized,
      });
    }
  } finally {
    await intro.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} query(ies) could not be typed:`);
    for (const f of failures) {
      console.error(`  ✗ ${f.file}:${f.line} ${f.name} — ${f.error}`);
      console.error(`    ${f.sql.trim().replace(/\s+/g, ' ').slice(0, SQL_PREVIEW_LONG)}`);
      console.error('    (add /* @skip */ to type this one by hand)');
    }
  }

  const typed = emitModels.length;
  let changed = false;
  if (typed > 0) {
    const contents = emitModule({
      queries: emitModels,
      packageName: options.packageName ?? DEFAULT_PACKAGE,
    });
    if (safeRead(outPath) !== contents) {
      changed = true;
      if (check) {
        console.error(`would change: ${relative(cwd, outPath)}`);
      } else {
        writeFileSync(outPath, contents);
      }
    }
  }

  if (check && changed) {
    console.error('\n✗ generated types are stale — regenerate and commit.');
  } else {
    const summary =
      `${typed} typed` +
      (skipped ? `, ${skipped} skipped` : '') +
      (failures.length ? `, ${failures.length} failed` : '');
    console.log(`${check ? '✓ up to date' : '✓ generated'} (${summary})`);
  }

  return { typed, skipped, failures, changed };
}

// ---- helpers ----------------------------------------------------------------

// Two queries sharing a name (the `sql.Name` property) would emit clashing
// interfaces and registry keys.
function requireUniqueNames(discovered: Array<{ q: DiscoveredQuery; file: string }>): void {
  const seen = new Map<string, string>();
  for (const { q, file } of discovered) {
    const at = `${basename(file)}:${q.line}`;
    const prev = seen.get(q.name);
    if (prev) {
      const preview = q.sql.trim().replace(/\s+/g, ' ').slice(0, SQL_PREVIEW_SHORT);
      throw new Error(
        `duplicate query name "${q.name}" (${prev} and ${at})\n` +
          `  ${preview}…\n` +
          '  Names must be unique: rename one of the `sql.Name` tags.',
      );
    }
    seen.set(q.name, at);
  }
}

// Load `sqlgen.config.{ts,js,mjs}` from the root (or an explicit path); {} when absent.
async function loadConfig(input: { root: string; explicit?: string }): Promise<SqlgenConfig> {
  const path = input.explicit
    ? resolve(input.explicit)
    : ['sqlgen.config.ts', 'sqlgen.config.js', 'sqlgen.config.mjs']
        .map((f) => join(input.root, f))
        .find((f) => existsSync(f));
  if (!path) {
    return {};
  }
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: SqlgenConfig;
  } & SqlgenConfig;
  return mod.default ?? mod;
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0] ?? message;
}

function safeRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
