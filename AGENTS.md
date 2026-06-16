## Project

Bun + TypeScript monorepo for `@ilbertt/bun-sqlgen` (`packages/*`, `examples/*`).

## Stack

- **Runtime:** Bun
- **Monorepo:** Bun workspaces + Turbo
- **Linter/Formatter:** Biome (auto-formats on save)
- **Commits:** Conventional Commits (commitlint)

## Code style
bun 
- No comments that restate what types and naming already say — only comment the non-obvious
- Imports use `#*` subpath mapping (e.g. `import { foo } from '#services/foo'`)
- Single source of truth — never duplicate keys, enum values, or type info that belongs to a class/module; derive from the source instead
- Biome enforces `useMaxParams: 1` — wrap multiple params in an object. Exception: callbacks whose signature we don't control (native functions like `.map((x, i) => …)`/`.forEach`, or an external dependency's API) — match the required shape and add a one-line `// biome-ignore lint/complexity/useMaxParams: …` rather than contorting the code to satisfy the rule
- Only re-export from index files - Biome enforces that

## Validation

After finishing an implementation, always run:

1. `bun fix:codestyle` — auto-fix formatting/lint issues
2. `bun check:all` — verify types and codestyle pass
3. `bun run build` — verify the build succeeds

Check `package.json` scripts (root and per-package) for other available commands.

## Run scripts

When running a script, always check `package.json` scripts (root and per-package) for available commands first.

## READMEs

Packages fall in two buckets:

- **Published packages** (have a `pkg/` directory) carry **two** READMEs:
  - **`packages/<package>/pkg/README.md`** — public, user-facing. Ships to npm as part of `@ilbertt/<package>` (listed under `"files"` in `pkg/package.json`). This is what users see on the npm page. Covers install, usage, and public API. Must use the published name (`@ilbertt/...`), not the workspace name (`@repo/...`).
  - **`packages/<package>/README.md`** — internal contributor doc. Covers source layout, dev scripts, and constraints. **Must link to `pkg/README.md`** and **must not duplicate install/usage** — when in doubt, the public README wins and the internal one points to it.
- **Internal-only packages** (no `pkg/`) may not need a README at all. Add one only when there's contributor-relevant context that isn't obvious from the source.

When editing a published package, decide which audience the change is for and update only that file. If something belongs to both (e.g. a renamed export), update them in lockstep.

The root `README.md` is the project homepage: typically lists the public packages/examples and a quick-start. Keep it short — deep usage lives in each `pkg/README.md`.

## Releasing

Releases are automated and driven by Conventional Commits:

- **`prepare-release`** workflow (manual dispatch) computes the next version with git-cliff, writes it to `packages/bun-sqlgen/pkg/package.json`, regenerates `CHANGELOG.md`, and opens a release PR.
- **`publish`** workflow runs on `v*` tag push: builds and publishes `@ilbertt/bun-sqlgen` to npm (Trusted Publishing / provenance) and creates a GitHub Release.

## Bun version

The Bun version is pinned in `.bun-version`. When bumping it, also update `engines.bun` in `packages/bun-sqlgen/pkg/package.json` so the published package advertises the matching minimum.

## Pull requests

Keep PR descriptions minimal — the diff is self-explanatory, so don't enumerate every change. State the intent in a line or two.

## Keeping this file up to date

When a change affects code style, tooling, conventions, or project taste (new lint rules, formatter config, naming patterns, dependency choices, etc.), propose updating this file to reflect it.
