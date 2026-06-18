# @repo/bun-sqlgen

> **Note:** This is the internal development package. The README that gets published to npm lives in [`pkg/README.md`](./pkg/README.md) — that is the one users of the package will see.

This package ships **two entries** under one published name
[`@ilbertt/bun-sqlgen`](./pkg/README.md):

- **`src/index.ts`** + **`src/lib/`** — the `.` export: `withTypes` and the
  `QueryResults` registry that generated `*.gen.d.ts` files augment. It's a
  **Bun-only** package, so the `.` export's `bun` condition points at the TypeScript
  **source** (`build.ts` copies it to `pkg/src/`, which Bun runs directly), while the
  `types` condition points at generated `.d.ts` in `pkg/dist/` (`tsc
  --emitDeclarationOnly`) so editors/`tsc` and the npm types badge resolve cleanly.
- **`src/cli/`** — the `bun-sqlgen` bin (not exported), a thin
  [parsh](https://github.com/ilbertt/parsh) front-end over
  [`@repo/bun-sqlgen-core`](../bun-sqlgen-core) (the actual generator library),
  which it **bundles** into the single `dist/cli/main.js`.

CLI commands are file-routed (filename → command path), so `_root.ts`/`[glob].ts`
are parsh conventions, and `*.gen.ts` is excluded from Biome (the generator owns
its formatting). Adding/renaming a command means re-running codegen:

```sh
bun run codegen   # parsh-codegen → src/cli/command-tree.gen.ts (commit the result)
```

Only the CLI is bundled. `build.ts` externalizes the two deps that can't (or
shouldn't) be inlined: **PGlite** (its WASM data file is resolved from disk at
runtime, so it can't be bundled — a `dependency`) and **TypeScript** (large, and
any consumer already has it — a `peerDependency`). Everything else (parsh, zod,
and the `workspace:` core) is bundled into the binary, so the published package
declares just those two. The lib isn't bundled — its source is copied and its
`.d.ts` emitted alongside.

## Dev scripts

```sh
bun run build         # bundle the CLI + copy the lib source into pkg/dist
bun run check:types   # type-check with tsc
bun run codegen       # regenerate the parsh command tree
```

The example under [`examples/simple`](../../examples/simple) exercises the
generator end-to-end (`bun run codegen` there).

## Publishing

Releases are automated via the `prepare-release` and `publish` GitHub workflows.
To publish manually from the [`pkg/`](./pkg/) directory:

```sh
bun run build
cd pkg && npm publish --access public
```
