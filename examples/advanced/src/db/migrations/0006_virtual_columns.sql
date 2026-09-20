-- A VIRTUAL generated column: Postgres reports it nullable, but it is always present.
ALTER TABLE users ADD COLUMN search_key text GENERATED ALWAYS AS (lower(email)) VIRTUAL;
COMMENT ON COLUMN users.search_key IS 'Lowercased email, for lookups. @notNull';

ALTER TABLE deals ADD COLUMN search_key text GENERATED ALWAYS AS (lower(status)) VIRTUAL;
COMMENT ON COLUMN deals.search_key IS 'Lowercased status, for lookups. @notNull';
