# @repo/bun-sqlgen

> **Note:** This is the internal development package. The README that gets published to npm lives in [`pkg/README.md`](./pkg/README.md) — that is the one users of the package will see.

This package ships **two entries** under one published name
[`@ilbertt/bun-sqlgen`](./pkg/README.md):

- **`src/lib.ts`** — the `.` export: `withTypes` and the `QueryResults` registry
  that generated `*.gen.d.ts` files augment. Self-contained (only `bun` types), so
  it's a featherweight runtime import.
- **`src/cli/`** — the `bun-sqlgen` bin (not exported), a thin
  [parsh](https://github.com/ilbertt/parsh) front-end over
  [`@repo/bun-sqlgen-core`](../bun-sqlgen-core) (the actual generator library),
  which it **bundles** into the binary.

Both build into [`pkg/`](./pkg/) (`dist/lib.{js,d.ts}` + `dist/cli/main.js`).

CLI commands are file-routed (filename → command path), so `_root.ts`/`[glob].ts`
are parsh conventions, and `*.gen.ts` is excluded from Biome (the generator owns
its formatting). Adding/renaming a command means re-running codegen:

```sh
bun run codegen   # parsh-codegen → src/cli/command-tree.gen.ts (commit the result)
```

`build.ts` externalizes declared runtime deps (PGlite, TypeScript, parsh, zod) so
they aren't inlined — but **skips `workspace:` deps**, so `@repo/bun-sqlgen-core`
is bundled into the binary rather than published as a dependency. The `lib.ts`
types are emitted with `tsc` (clean `.d.ts`, no `#subpath` leakage).

## Dev scripts

```sh
bun run build         # bundle src/main.ts into pkg/dist (deps externalized)
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
