import type { Extensions } from '@electric-sql/pglite';

/** Which engine introspects the migrations at build time. Defaults to `postgres`. */
export type Dialect = 'postgres' | 'sqlite';

interface BaseConfig {
  /** Database engine the queries run against. Defaults to `postgres`. */
  dialect?: Dialect;
  /**
   * Emit the schema block — every table and view with its columns, index names and
   * constraint names. Defaults to `true`; `--no-schema` turns it off from the CLI.
   */
  schema?: boolean;
  /**
   * Fail unless every migration filename carries a unique sequence prefix, all of one
   * width — migrations apply in filename order, so `1, 2, 10` applies as `1, 10, 2`.
   * `true` expects a numeric prefix; pass a `RegExp` for any other scheme
   * (`/^\d{14}_/` for timestamps, `/^[a-z]{4}_/` for letters). Defaults to `false`;
   * `--check-migration-order` turns on the numeric default from the CLI.
   */
  checkMigrationOrder?: boolean | RegExp;
  /** SQL run before migrations (stub functions/types/extensions). */
  prelude?: string;
  /** Rewrite or strip statements the throwaway DB can't run, per migration file. */
  transformMigration?: (input: { sql: string; filename: string }) => string;
}

/** Postgres config: introspection runs against an in-process PGlite. */
export interface PostgresConfig extends BaseConfig {
  dialect?: 'postgres';
  /** PGlite extensions to load before applying migrations. */
  extensions?: () => Extensions | Promise<Extensions>;
}

/** SQLite config: introspection runs against an in-memory `bun:sqlite` database. */
export interface SqliteConfig extends BaseConfig {
  dialect: 'sqlite';
}

/** `sqlgen.config.ts` — shapes the throwaway introspection DB to match production. */
export type SqlgenConfig = PostgresConfig | SqliteConfig;

/**
 * Identity helper for `sqlgen.config.ts`, à la Vite's `defineConfig`: it returns the
 * config untouched but pins it to `SqlgenConfig`, so the default export is type-checked
 * and autocompleted without an explicit annotation.
 */
export function defineConfig(config: SqlgenConfig): SqlgenConfig {
  return config;
}
