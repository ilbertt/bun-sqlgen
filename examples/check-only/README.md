# check-only

Uses [`@ilbertt/bun-sqlgen`](../../packages/bun-sqlgen/pkg/README.md) purely as a
**build-time SQL checker** — no result types are generated. `--check-queries` plans
every discovered query against the schema and fails on any that don't (a missing
column, a renamed table, a bad cast), writing and committing nothing.

Reach for this lane when you want CI to guard your raw SQL but don't consume the
typed registry. For the typed lane — generated row types with `tsc`-checked call
sites — see [`simple`](../simple).

- `src/db/migrations/*.sql` — the schema the queries are checked against.
- `src/queries.ts` — named `sql.Name\`...\`` queries. Naming is how the checker
  discovers them (the same opt-in the typed lane uses). Because the registry is
  never generated, each name is unknown to `tsc`, so every query carries a
  `// @ts-expect-error` saying so — `tsc` still runs over the rest of the file.
- No `queries.gen.d.ts` is committed: the describe-time `--check-queries` pass **is**
  the gate, and `check:types` runs it before `tsc`.

## Scripts

```sh
bun run check:queries   # plan every query against the schema; exit 1 on any failure
bun run check:types     # check:queries, then tsc over the source
```

Break a query — select a column that doesn't exist — and `check:queries` fails with
the real Postgres error, pointing at the file and line. `--check-queries` ignores
output freshness entirely; the sibling `--check-stale` (or `--check` for both) is
what guards a committed `queries.gen.d.ts` in the typed lane.
