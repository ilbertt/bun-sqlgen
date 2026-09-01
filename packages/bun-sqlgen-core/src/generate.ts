import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiscoverer } from '#discover.ts';
import { emitModule, GENERATED_MARKER } from '#emit/index.ts';
import { createIntrospector } from '#introspect/index.ts';
import { requireOrderedMigrations } from '#introspect/migrations.ts';
import {
  parseColumnComments,
  parseOverrides,
  resolveFields,
  resolveTableColumns,
} from '#nullability.ts';
import type {
  Dialect,
  DiscoveredQuery,
  EmitModel,
  EmitTable,
  IntrospectorOptions,
} from '#types.ts';

type LoadedConfig = Partial<Omit<IntrospectorOptions, 'migrationsDir'>> &
  Pick<GenerateOptions, 'schema' | 'checkMigrationOrder'>;

// Where the aggregated module lands when `--out` is omitted. A `.ts`, not a `.d.ts`:
// the module is a normal source file, so it can carry values as well as types.
const DEFAULT_OUT = 'src/queries.gen.ts';

// The package whose `QueryResults` registry the generated `declare module` augments.
// Real users import `withTypes` from here; override with `--package` (e.g. a workspace alias).
const DEFAULT_PACKAGE = '@ilbertt/bun-sqlgen';

export interface GenerateOptions {
  /** Glob(s) for query source files, e.g. `src/**\/*.ts`. Relative to `cwd`. */
  queries: string | string[];
  /** Migrations directory, relative to `cwd`. */
  migrations: string;
  /** Fail if any discovered query doesn't plan against the schema. Read-only (no write). */
  checkQueries?: boolean;
  /** Fail if the committed generated module is out of date. Read-only (no write). */
  checkStale?: boolean;
  /**
   * Fail unless every migration filename carries a unique sequence prefix, all of one
   * width — what makes filename order (the order they apply in) the intended one.
   * `true` expects a numeric prefix; a `RegExp` says where the prefix ends instead.
   * Overrides config; defaults to `false`. Unlike the other checks it guards generation
   * itself, so it runs in every mode rather than replacing the write.
   */
  checkMigrationOrder?: boolean | RegExp;
  /** Explicit path to `sqlgen.config.{ts,js,mjs}`; auto-discovered otherwise. */
  configPath?: string;
  /** Output path for the aggregated module, relative to `cwd`. Defaults to `src/queries.gen.ts`. */
  out?: string;
  /** Package whose `QueryResults` registry to augment. Defaults to `@ilbertt/bun-sqlgen`. */
  packageName?: string;
  /** Base directory for globs, migrations, and tsconfig lookup. Defaults to cwd. */
  cwd?: string;
  /** Database engine to introspect against. Overrides config; defaults to `postgres`. */
  dialect?: Dialect;
  /**
   * Emit the schema block — every table and view with its columns, index names and
   * constraint names. Overrides config; defaults to `true`.
   */
  schema?: boolean;
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
  failures: GenerateFailure[];
  changed: boolean;
}

const SQL_PREVIEW_LONG = 90;
const SQL_PREVIEW_SHORT = 70;

/**
 * The `sqlx prepare` analog: discover `sql.Name\`...\`` tags -> describe each
 * against PGlite -> resolve types/nullability -> write one aggregated module that
 * augments the package's `QueryResults` registry. Source files are never touched;
 * `withTypes` reads each row type from the registry at the call site.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const checkQueries = options.checkQueries ?? false;
  const checkStale = options.checkStale ?? false;
  // Any check mode is read-only; the file is written only on a plain generate.
  const writeOutput = !checkQueries && !checkStale;

  // Explicit options win over config values.
  const config = await loadConfig({ root: cwd, explicit: options.configPath });

  const migrationsDir = resolve(cwd, options.migrations);
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT);

  // Before anything expensive: a misordered set builds the wrong schema silently.
  const checkOrder = options.checkMigrationOrder ?? config.checkMigrationOrder ?? false;
  if (checkOrder) {
    requireOrderedMigrations({ migrationsDir, pattern: checkOrder });
  }

  // Resolve the query globs; skip our own generated output.
  const globs = Array.isArray(options.queries) ? options.queries : [options.queries];
  const matched = new Set<string>();
  for (const pattern of globs) {
    for (const f of new Bun.Glob(pattern).scanSync({ cwd, absolute: true, onlyFiles: true })) {
      matched.add(f);
    }
  }
  // Sort so the discovery — and therefore the emitted registry order — is stable
  // across platforms; Bun.Glob yields filesystem order, which differs (macOS vs
  // Linux CI), making the committed output churn and `--check` fail spuriously.
  const sourceFiles = [...matched].filter((f) => f !== outPath && !isGenerated(f)).sort();

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
  const failures: GenerateFailure[] = [];
  const emitModels: EmitModel[] = [];
  const neutralized: string[] = [];
  let tables: EmitTable[] = [];

  // Everything that reads the throwaway database runs inside one try, so any failure
  // along the way still closes it — `generate()` is called programmatically too, and a
  // leaked PGlite instance stays resident for the life of the process.
  try {
    const catalog = await intro.catalog();
    const columnOverrides = parseColumnComments(await intro.columnComments());
    const writable = await intro.writableColumns();

    // The schema block reuses the column comments, so a `@type`/`@notNull` declared once
    // shapes a column the same way in the table listing and in every query selecting it.
    const emitSchema = options.schema ?? config.schema ?? true;
    tables = emitSchema
      ? (await intro.tables()).map((table) => ({
          ...table,
          columns: resolveTableColumns({ table, columnOverrides }),
        }))
      : [];

    // `writable` lets SET-clause neutralization self-assign a real column.
    const discover = createDiscoverer({ projectRoot: cwd, files: sourceFiles, writable, dialect });

    // All queries feed one aggregated registry, so names must be unique project-wide.
    const discovered: Array<{ q: DiscoveredQuery; file: string }> = [];
    for (const file of sourceFiles) {
      for (const q of discover(file)) {
        discovered.push({ q, file });
      }
    }
    requireUniqueNames(discovered);

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
      emitModels.push({ name: q.name, resultFields });
      if (q.neutralized) {
        neutralized.push(q.name);
      }
    }
  } finally {
    await intro.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} query(ies) could not be typed:`);
    for (const f of failures) {
      console.error(`  ✗ ${f.file}:${f.line} ${f.name} — ${f.error}`);
      console.error(`    ${f.sql.trim().replace(/\s+/g, ' ').slice(0, SQL_PREVIEW_LONG)}`);
      console.error('    (drop the `sql.Name` tag and hand-type it: `sql<Row[]>`...`)');
    }
  }

  // Neutralized queries had dynamic clauses rewritten to type them; the row shape
  // holds, but a dynamic SELECT column could be dropped/retyped. Flag them here at
  // generation time rather than commenting the generated file.
  if (neutralized.length) {
    console.log(
      `\nℹ ${neutralized.length} query(ies) had dynamic clauses neutralized — verify SELECT columns:`,
    );
    console.log(`  ${neutralized.join(', ')}`);
  }

  const typed = emitModels.length;
  let changed = false;
  // The module carries the schema block as well as the query types, so it is worth
  // writing for either one alone.
  if (typed > 0 || tables.length > 0) {
    const contents = emitModule({
      queries: emitModels,
      tables,
      packageName: options.packageName ?? DEFAULT_PACKAGE,
    });
    if (safeRead(outPath) !== contents) {
      changed = true;
      if (writeOutput) {
        writeFileSync(outPath, contents);
      } else if (checkStale) {
        console.error(`would change: ${relative(cwd, outPath)}`);
      }
    }
    if (dropSuperseded({ outPath, cwd, write: writeOutput })) {
      changed = true;
    }
  }

  if (checkStale && changed) {
    console.error('\n✗ generated types are stale — regenerate and commit.');
  } else {
    const summary = `${typed} typed${failures.length ? `, ${failures.length} failed` : ''}`;
    let status = '✓ queries valid';
    if (failures.length) {
      status = '✗ failed';
    } else if (writeOutput) {
      status = '✓ generated';
    } else if (checkStale) {
      status = '✓ up to date';
    }
    console.log(`${status} (${summary})`);
  }

  return { typed, failures, changed };
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
async function loadConfig(input: { root: string; explicit?: string }): Promise<LoadedConfig> {
  const path = input.explicit
    ? resolve(input.explicit)
    : ['sqlgen.config.ts', 'sqlgen.config.js', 'sqlgen.config.mjs']
        .map((f) => join(input.root, f))
        .find((f) => existsSync(f));
  if (!path) {
    return {};
  }
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: LoadedConfig;
  } & LoadedConfig;
  return mod.default ?? mod;
}

/**
 * Remove the `.d.ts` this `.gen.ts` output replaced. Left in place it stays in the
 * program and contributes a second `declare module` augmentation from a stale registry
 * — which TypeScript accepts silently rather than flagging, so the old shape can quietly
 * win. Only ever removes a file carrying our own generated header.
 */
function dropSuperseded(input: { outPath: string; cwd: string; write: boolean }): boolean {
  const { outPath, cwd, write } = input;
  if (!outPath.endsWith('.gen.ts')) {
    return false;
  }
  const superseded = `${outPath.slice(0, -'.ts'.length)}.d.ts`;
  if (!safeRead(superseded)?.includes(GENERATED_MARKER)) {
    return false;
  }
  const at = relative(cwd, superseded);
  if (write) {
    rmSync(superseded);
    console.log(`removed superseded ${at}`);
  } else {
    console.error(`would remove: ${at}`);
  }
  return true;
}

// Our own output, never fed back in as a query source.
function isGenerated(file: string): boolean {
  return file.endsWith('.gen.ts');
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
