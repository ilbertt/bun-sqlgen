-- The schema is the source of truth for nullability (NOT NULL lives here).
CREATE TABLE users (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email        text NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deals (
  id        bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id   bigint NOT NULL REFERENCES users(id),
  amount    numeric NOT NULL,
  status    text NOT NULL DEFAULT 'draft'
);
