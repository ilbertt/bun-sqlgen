ALTER TABLE users
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
