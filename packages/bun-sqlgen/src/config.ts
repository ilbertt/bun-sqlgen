import type { Extensions } from '@electric-sql/pglite';

/** Which engine introspects the migrations at build time. Defaults to `postgres`. */
export type Dialect = 'postgres' | 'sqlite';

interface BaseConfig {
  /** Database engine the queries run against. Defaults to `postgres`. */
  dialect?: Dialect;
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
