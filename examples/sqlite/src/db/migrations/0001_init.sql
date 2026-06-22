CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deals (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  amount     REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  is_active  BOOLEAN NOT NULL DEFAULT 1,
  closed_at  DATETIME,
  attachment BLOB
);
