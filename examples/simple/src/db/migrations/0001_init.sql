-- Source of truth for the schema. NOT NULL lives here, which is how we get
-- nullability right (the Postgres describe protocol alone can't tell you).
CREATE TABLE users (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email        text NOT NULL,
  display_name text,                       -- nullable
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deals (
  id        bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id   bigint NOT NULL REFERENCES users(id),
  amount    numeric NOT NULL,
  status    text NOT NULL DEFAULT 'draft'
);
