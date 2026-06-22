import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const filename of files) {
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

export function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0] ?? message;
}
