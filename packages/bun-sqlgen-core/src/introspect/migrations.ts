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

const SEQUENCE_PREFIX = /^\d+/;

/**
 * Migrations apply in filename order, which agrees with the order their numbers imply
 * only while every prefix is padded to the same width: `1, 2, 10` applies as
 * `1, 10, 2`, building a different schema than production without failing. Opt-in via
 * `checkMigrationOrder`, since an unnumbered scheme is a valid choice on its own.
 */
export function requireOrderedMigrations(migrationsDir: string): void {
  const problems: string[] = [];
  const numbered: Array<{ filename: string; sequence: number }> = [];

  for (const filename of listMigrations(migrationsDir)) {
    const prefix = SEQUENCE_PREFIX.exec(filename)?.[0];
    if (prefix === undefined) {
      problems.push(`${filename} — no leading sequence number`);
      continue;
    }
    numbered.push({ filename, sequence: Number(prefix) });
  }

  // Two migrations claiming the same number — the usual merge accident — leave the
  // order between them to the rest of the filename.
  const bySequence = new Map<number, string>();
  for (const { filename, sequence } of numbered) {
    const claimed = bySequence.get(sequence);
    if (claimed === undefined) {
      bySequence.set(sequence, filename);
    } else {
      problems.push(`${filename} — same sequence number as ${claimed}`);
    }
  }

  // The list is already in applied order, so "ascending across every adjacent pair"
  // is exactly "filename order == numeric order".
  let previous: { filename: string; sequence: number } | null = null;
  for (const entry of numbered) {
    if (previous && previous.sequence > entry.sequence) {
      problems.push(
        `${previous.filename} — applies before ${entry.filename}, but ${previous.sequence} > ${entry.sequence}`,
      );
    }
    previous = entry;
  }

  if (problems.length) {
    throw new Error(
      `migrations are not in sequence order:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n` +
        '  Migrations apply in filename order — zero-pad the prefixes (0001, 0002, … 0010) so it matches.',
    );
  }
}

export function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0] ?? message;
}
