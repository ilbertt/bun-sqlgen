# @repo/bun-sqlgen

> **Note:** Internal development package. The README published to npm lives in
> [`pkg/README.md`](./pkg/README.md) — that's the one package users see.

Ships three things under one published name
[`@ilbertt/bun-sqlgen`](./pkg/README.md): the `withTypes` runtime library (the `.`
export), the `defineConfig` helper (the `./config` export), and the `bun-sqlgen` CLI
bin — a thin [parsh](https://github.com/ilbertt/parsh) front-end over
[`@repo/bun-sqlgen-core`](../bun-sqlgen-core), the actual generator.

`./config` (`src/config.ts`) is self-contained — it defines the config contract and
`defineConfig`, importing only `@electric-sql/pglite` — so the standard lib build
(`tsconfig.build.json`) emits a dependency-free `pkg/dist/config.{js,d.ts}` alongside
`index.*`, with no special build step. It is deliberately **not** a re-export of
[`@repo/bun-sqlgen-core`](../bun-sqlgen-core): that would leak the private package into
the published declaration. Core consumes only the resolved introspection settings
(`IntrospectorOptions`); its config loader casts the loaded module to a shape derived
from those, so the two stay compatible without core depending on this submodule.

## Publishing

Releases are automated via the `prepare-release` and `publish` GitHub workflows. To
publish manually from [`pkg/`](./pkg/):

```sh
bun run build
cd pkg && bun publish --access public
```
