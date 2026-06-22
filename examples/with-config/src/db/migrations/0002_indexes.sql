-- Two statements, so this file is applied inside a transaction — and
-- `CREATE INDEX CONCURRENTLY` cannot run in one. Production keeps CONCURRENTLY to
-- avoid locking writes while the index builds; the config's `transformMigration`
-- strips it for the throwaway DB, which has no concurrency to worry about.
CREATE INDEX articles_author_idx ON articles (author_id);
CREATE INDEX CONCURRENTLY articles_slug_idx ON articles (slug);
