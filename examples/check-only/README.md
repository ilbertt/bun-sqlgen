# check-only

Uses [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md) purely as a
**build-time SQL checker** — no result types are generated. `--check-queries` plans
every discovered named query against the schema and fails on any that don't (a
missing column, a renamed table, a bad cast), writing and committing nothing.

Reach for this lane when you want CI to guard your raw SQL but don't consume the
typed registry. For the typed lane — generated row types with `tsc`-checked call
sites — see [`basic`](../basic). Because the registry is never generated, each
query name is unknown to `tsc`, so every query carries a `// @ts-expect-error`;
`tsc` still runs over the rest of the file, and the describe-time `--check-queries`
pass is the real gate (`check:types` runs it before `tsc`).

Run these commands from this directory; all write nothing:

| Command | Flags | Checks |
| --- | --- | --- |
| `bun run check:queries` | `--check-queries` | Queries plan against the schema; errors point at the file and line. |
| `bun run check:stale` | `--check-stale` | Generated types match the current queries and schema. |
| `bun run check:migration-order` | `--check-queries --check-migration-order '^\d+'` | Queries are valid and migration prefixes are present, unique, and the same width. |
| `bun run check` | `--check` | Query validity and generated-type freshness. |

`check:stale` and `check` fail here because `queries.gen.ts` is intentionally absent;
use them in the typed lane. `--check` doesn't include migration order. The
migration-order command adds `--check-queries` to avoid generating types.
