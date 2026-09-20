CREATE TABLE users (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email        text NOT NULL,
  display_name text,
  login_count  integer NOT NULL DEFAULT 0,
  is_admin     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
