// This package uses bun-sqlgen purely to validate SQL: `check:queries` plans every
// query against the schema in src/db/migrations, but no result types are generated.
// Queries are named so the checker discovers them; `withTypes` is what lets a named
// tag forward to Bun's `sql` and run at runtime. Because we never emit the registry,
// each name is unknown to `tsc` — the `@ts-expect-error` on each says so on purpose,
// so `check:types` stays green without excluding the file. See `simple` for the
// typed lane, where generation turns these names into checked row types.
import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));

export const listOpenTasks = (projectId: number) =>
  // @ts-expect-error — types intentionally not generated for this query; SQL still checked.
  sql.ListOpenTasks`
    SELECT t.id, t.title, t.due_at
    FROM tasks t
    WHERE t.project_id = ${projectId} AND NOT t.done
    ORDER BY t.due_at NULLS LAST
  `;

export const openTasksPerProject = () =>
  // @ts-expect-error — types intentionally not generated for this query; SQL still checked.
  sql.OpenTasksPerProject`
    SELECT p.name, count(t.id) AS open_tasks
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id AND NOT t.done
    GROUP BY p.name
  `;
