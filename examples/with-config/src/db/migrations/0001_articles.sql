-- `citext` (case-insensitive text) comes from an extension. In production it is
-- installed ahead of the app; the throwaway introspection DB loads it via the
-- config's `extensions`, and this CREATE EXTENSION enables it in both places.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE authors (
  id    bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email citext NOT NULL UNIQUE,
  name  text NOT NULL
);

CREATE TABLE articles (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  author_id  bigint NOT NULL REFERENCES authors(id),
  slug       citext NOT NULL UNIQUE,
  title      text NOT NULL,
  body       text,
  -- DEFAULTs to a function the app provides at runtime (not in these migrations).
  -- The config's `prelude` stubs `app_current_actor()` so this table can be created.
  created_by text NOT NULL DEFAULT app_current_actor()
);

-- An extension type has a dynamic OID the generator can't map, so a bare `citext`
-- column would land as `unknown`. Shape it once here and the prose becomes JSDoc.
COMMENT ON COLUMN authors.email IS 'Case-insensitive contact address. @type string';
COMMENT ON COLUMN articles.slug IS 'Case-insensitive URL slug. @type string';
