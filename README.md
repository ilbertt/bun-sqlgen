# bun-sqlgen

SQL generation utilities for [Bun](https://bun.sh), developed as a monorepo powered by [Bun](https://bun.sh) and [Turborepo](https://turborepo.dev/).

The published package is [`@ilbertt/bun-sqlgen`](./packages/bun-sqlgen/pkg/README.md).

## Requirements

- [Bun](https://bun.sh)

## Getting started

```sh
bun install
bun run build
```

Run the example:

```sh
bun --filter @repo/example-simple start
```

## Tooling

- [Bun](https://bun.sh) — runtime, package manager, bundler
- [Turborepo](https://turborepo.dev/) — task orchestration with caching
- [Biome](https://biomejs.dev/) — linter and formatter
- [commitlint](https://commitlint.js.org/) — conventional commit enforcement
- [git-cliff](https://git-cliff.org/) — changelog generation and version bumping
- [TypeScript](https://www.typescriptlang.org/) — shared config via `@repo/typescript-config`
