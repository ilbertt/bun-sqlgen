import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiscoverer } from '#discover.ts';
import { emitFile } from '#emit.ts';
import { createIntrospector } from '#introspect.ts';
import { parseOverrides, resolveFields } from '#nullability.ts';
import type { DiscoveredQuery, EmitModel, SqlgenConfig } from '#types.ts';

// Suffix of the files we emit — used both to name outputs and to skip them on
// re-runs, so they're never fed back in as query sources.
const GENERATED_SUFFIX = '.gen.d.ts';

export interface GenerateOptions {
  /** Glob(s) for query source files, e.g. `src/**\/*.ts`. Relative to `cwd`. */
  queries: string | string[];
  /** Migrations directory, relative to `cwd`. */
  migrations: string;
  /** Fail (don't write) if any generated file would change — the CI analog. */
  check?: boolean;
  /** Explicit path to `sqlgen.config.{ts,js,mjs}`; auto-discovered otherwise. */
  configPath?: string;
  /** Base directory for globs, migrations, and tsconfig lookup. Defaults to cwd. */
  cwd?: string;
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

  // Resolve the query globs; skip only our own generated output.
  const globs = Array.isArray(options.queries) ? options.queries : [options.queries];
  const matched = new Set<string>();
  for (const pattern of globs) {
    for (const f of new Bun.Glob(pattern).scanSync({ cwd, absolute: true, onlyFiles: true })) {
      matched.add(f);
    }
  }
  const sourceFiles = [...matched].filter((f) => !f.endsWith(GENERATED_SUFFIX));

  const intro = await createIntrospector({
    migrationsDir,
    extensions: config.extensions,
    prelude: config.prelude,
    transformMigration: config.transformMigration,
  });
  const catalog = await intro.catalog();
  const types = await intro.types();
  const writable = await intro.writableColumns();

  // `writable` lets SET-clause neutralization self-assign a real column.
  const discover = createDiscoverer({ projectRoot: cwd, files: sourceFiles, writable });

  const writes: Array<{ path: string; contents: string }> = [];
  const failures: GenerateFailure[] = [];
  let typed = 0;
  let skipped = 0;

  try {
    for (const file of sourceFiles) {
      const queries = discover(file).filter((q) => {
        if (q.skip) {
          skipped++;
        }
        return !q.skip;
      });
      if (queries.length === 0) {
        continue;
      }

      requireUniqueNames({ queries, file: basename(file) });

      const emitModels: EmitModel[] = [];
      for (const q of queries) {
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
        const resultFields = resolveFields({ described, catalog, overrides, types });
        emitModels.push({ name: q.name, resultFields, neutralized: q.neutralized });
        typed++;
      }
      if (emitModels.length === 0) {
        continue;
      }

      const genPath = file.replace(/\.ts$/, GENERATED_SUFFIX);
      writes.push({
        path: genPath,
        contents: emitFile({ relSourcePath: relative(cwd, file), queries: emitModels }),
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

  let changed = false;
  for (const w of writes) {
    if (safeRead(w.path) !== w.contents) {
      changed = true;
      if (check) {
        console.error(`would change: ${relative(cwd, w.path)}`);
      } else {
        writeFileSync(w.path, w.contents);
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

// Two queries sharing a `@name` would emit clashing interfaces.
function requireUniqueNames(input: { queries: DiscoveredQuery[]; file: string }): void {
  const seen = new Set<string>();
  for (const q of input.queries) {
    if (seen.has(q.name)) {
      const preview = q.sql.trim().replace(/\s+/g, ' ').slice(0, SQL_PREVIEW_SHORT);
      throw new Error(
        `${input.file}:${q.line} — duplicate query name "${q.name}"\n` +
          `  ${preview}…\n` +
          '  Give each query a distinct  /* @name MyQuery */',
      );
    }
    seen.add(q.name);
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
