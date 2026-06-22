# bun-sqlgen

sqlx-style typed SQL for [`Bun.sql`](https://bun.sh/docs/runtime/sql): write raw
SQL in tagged templates, and a codegen step validates each query against an
in-process Postgres and emits the result types — so plain `tsc` catches wrong
property access and null-unsafety. Developed as a monorepo powered by
[Bun](https://bun.sh) and [Turborepo](https://turborepo.dev/).

The published package is [`@ilbertt/bun-sqlgen`](./packages/bun-sqlgen/pkg/README.md) —
see its README for install and usage.

## Requirements

- [Bun](https://bun.sh)

## Getting started

```sh
bun install
bun run build
```

## Examples

See the [`examples`](./examples) folder for common usage patterns of `bun-sqlgen`.

## Tooling

- [Bun](https://bun.sh) — runtime, package manager, bundler
- [Turborepo](https://turborepo.dev/) — task orchestration with caching
- [Biome](https://biomejs.dev/) — linter and formatter
- [commitlint](https://commitlint.js.org/) — conventional commit enforcement
- [git-cliff](https://git-cliff.org/) — changelog generation and version bumping
- [TypeScript](https://www.typescriptlang.org/) — shared config via `@repo/typescript-config`
