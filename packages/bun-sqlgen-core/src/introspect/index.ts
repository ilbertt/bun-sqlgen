import { createPostgresIntrospector } from '#introspect/postgres.ts';
import { createSqliteIntrospector } from '#introspect/sqlite.ts';
import type { Introspector, IntrospectorOptions } from '#types.ts';

/** Build the throwaway introspection DB for the configured dialect. */
export function createIntrospector(opts: IntrospectorOptions): Promise<Introspector> {
  return opts.dialect === 'sqlite'
    ? createSqliteIntrospector(opts)
    : createPostgresIntrospector(opts);
}
