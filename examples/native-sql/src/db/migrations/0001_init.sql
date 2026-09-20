CREATE TABLE messages (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
