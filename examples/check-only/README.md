# check-only

Uses [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md) purely as a
**build-time SQL checker** — no result types are generated. `--check-queries` plans
every discovered named query against the schema and fails on any that don't (a
missing column, a renamed table, a bad cast), writing and committing nothing.

Reach for this lane when you want CI to guard your raw SQL but don't consume the
typed registry. For the typed lane — generated row types with `tsc`-checked call
sites — see [`simple`](../simple). Because the registry is never generated, each
query name is unknown to `tsc`, so every query carries a `// @ts-expect-error`;
`tsc` still runs over the rest of the file, and the describe-time `--check-queries`
pass is the real gate (`check:types` runs it before `tsc`).

Break a query — select a column that doesn't exist — and `check:queries` fails with
the real Postgres error, pointing at the file and line. `--check-queries` ignores
output freshness entirely; the sibling `--check-stale` (or `--check` for both) is
what guards a committed `queries.gen.d.ts` in the typed lane.
