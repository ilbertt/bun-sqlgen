CREATE TABLE projects (
  id   bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL
);

CREATE TABLE tasks (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id bigint NOT NULL REFERENCES projects(id),
  title      text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  due_at     timestamptz
);
