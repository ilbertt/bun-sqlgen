import { citext } from '@electric-sql/pglite/contrib/citext';

// Shapes the throwaway PGlite introspection DB so the migrations apply exactly as
// they would against production. Auto-discovered by `bun-sqlgen` because it sits in
// the directory codegen runs from (or point at it with `--config`).
export default {
  // Make the `citext` extension available, so a migration's `CREATE EXTENSION
  // citext` can succeed. Real Postgres has it on disk; PGlite has to be handed it.
  extensions: () => ({ citext }),

  // SQL run before any migration. `app_current_actor()` is provided in production
  // by the app's session bootstrap, not by these migrations — stub it here so a
  // table whose column DEFAULTs to it can still be created in the throwaway DB.
  prelude: `
    CREATE FUNCTION app_current_actor() RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT 'system'::text $$;
  `,

  // Rewrite each migration before it is applied. A multi-statement file runs in a
  // transaction, and `CREATE INDEX CONCURRENTLY` cannot — production needs it to
  // avoid locking the table, the throwaway DB does not, so strip it.
  transformMigration: ({ sql }: { sql: string; filename: string }) =>
    sql.replace(/\bCONCURRENTLY\b/g, ''),
};
