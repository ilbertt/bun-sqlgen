-- Add an updated_at column to users: NOT NULL with a default of now() so the
-- backfill of existing rows is automatic.
ALTER TABLE users
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
