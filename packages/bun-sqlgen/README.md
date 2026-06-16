# @repo/bun-sqlgen

> **Note:** This is the internal development package. The README that gets published to npm lives in [`pkg/README.md`](./pkg/README.md) — that is the one users of the package will see.

The internal workspace package (`@repo/bun-sqlgen`) builds into [`pkg/`](./pkg/), which is the directory published to npm as [`@ilbertt/bun-sqlgen`](./pkg/README.md).

## Source layout

```
src/        # package source (entrypoint: src/index.ts)
build.ts    # bundles src/ into pkg/dist and syncs pkg/package.json deps
pkg/        # publish root — what ships to npm
```

## Dev scripts

```sh
bun run build         # bundle into pkg/dist
bun run check:types   # type-check with tsc
```

## Publishing

Releases are automated via the `prepare-release` and `publish` GitHub workflows.
To publish manually from the [`pkg/`](./pkg/) directory:

```sh
bun run build
cd pkg && npm publish --access public
```
