# @repo/bun-sqlgen

> **Note:** Internal development package. The README published to npm lives in
> [`pkg/README.md`](./pkg/README.md) — that's the one package users see.

Ships two things under one published name
[`@ilbertt/bun-sqlgen`](./pkg/README.md): the `withTypes` runtime library (the `.`
export) and the `bun-sqlgen` CLI bin — a thin
[parsh](https://github.com/ilbertt/parsh) front-end over
[`@repo/bun-sqlgen-core`](../bun-sqlgen-core), the actual generator.

## Publishing

Releases are automated via the `prepare-release` and `publish` GitHub workflows. To
publish manually from [`pkg/`](./pkg/):

```sh
bun run build
cd pkg && bun publish --access public
```
