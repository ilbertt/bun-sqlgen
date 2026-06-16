#!/usr/bin/env bun
const version = process.argv[2];
if (!version) {
  throw new Error('usage: bun scripts/set-version.ts <version>');
}

const PACKAGE_JSON_PATH = 'packages/bun-sqlgen/pkg/package.json';

const pkg = await Bun.file(PACKAGE_JSON_PATH).json();
pkg.version = version;
await Bun.write(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
