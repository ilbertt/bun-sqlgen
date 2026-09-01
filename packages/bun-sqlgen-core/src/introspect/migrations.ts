import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `*.sql` files in `migrationsDir`, in the order they are applied. */
function listMigrations(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Apply every `*.sql` migration in filename order to the throwaway DB, optionally
 * rewriting each via `transformMigration`. `exec` is the engine's multi-statement
 * runner (PGlite's `exec`, bun:sqlite's `run`).
 */
export async function applyMigrations(input: {
  migrationsDir: string;
  exec: (sql: string) => void | Promise<void>;
  transformMigration?: (input: { sql: string; filename: string }) => string;
}): Promise<void> {
  const { migrationsDir, exec, transformMigration } = input;
  for (const filename of listMigrations(migrationsDir)) {
    try {
      let sql = readFileSync(join(migrationsDir, filename), 'utf8');
      if (transformMigration) {
        sql = transformMigration({ sql, filename });
      }
      await exec(sql);
    } catch (e) {
      throw new Error(`migration ${filename} failed to apply: ${firstLine(e)}`);
    }
  }
}

/**
 * Migrations apply in filename order, so that is the order you meant only while every
 * filename carries a sequence prefix, all of them the same width and none repeated:
 * `1, 2, 10` applies as `1, 10, 2`. Width, not "is it a number", is the invariant —
 * equal-width prefixes sort the same way in any positional scheme, so a letter or
 * timestamp convention passes on its own terms. `prefixPattern` says where the prefix
 * ends; there is no default, since only the caller knows the convention it meant.
 */
export function requireOrderedMigrations(input: {
  migrationsDir: string;
  prefixPattern: RegExp;
}): void {
  // `exec` carries `lastIndex` between calls under `g`/`y`; each filename is its own test.
  const { prefixPattern } = input;
  const pattern = new RegExp(prefixPattern.source, prefixPattern.flags.replace(/[gy]/g, ''));

  const problems: string[] = [];
  const prefixes: Array<{ filename: string; prefix: string }> = [];

  for (const filename of listMigrations(input.migrationsDir)) {
    const match = pattern.exec(filename);
    // A match anywhere but the start orders nothing.
    const prefix = match?.index === 0 ? match[0] : null;
    if (prefix === null) {
      problems.push(`${filename} — no ${pattern} prefix`);
      continue;
    }
    prefixes.push({ filename, prefix });
  }

  // Two migrations claiming one prefix — the usual merge accident — leave the order
  // between them to whatever the rest of the filename happens to be.
  const claimedBy = new Map<string, string>();
  for (const { filename, prefix } of prefixes) {
    const claimed = claimedBy.get(prefix);
    if (claimed === undefined) {
      claimedBy.set(prefix, filename);
    } else {
      problems.push(`${filename} — same "${prefix}" prefix as ${claimed}`);
    }
  }

  const widest = Math.max(0, ...prefixes.map((p) => p.prefix.length));
  for (const { filename, prefix } of prefixes) {
    if (prefix.length < widest) {
      problems.push(`${filename} — "${prefix}" is ${prefix.length} wide, the widest is ${widest}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `migrations are not in a dependable order:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n` +
        `  They apply in filename order — give each a unique ${pattern} prefix, padded to one width.`,
    );
  }
}

export function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0] ?? message;
}
