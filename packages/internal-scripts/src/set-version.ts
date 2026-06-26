#!/usr/bin/env bun
import { join } from 'node:path';
import { REPO_ROOT } from '#paths.ts';

const version = Bun.argv[2];
if (!version) {
  throw new Error('usage: bun src/set-version.ts <version>');
}

const PACKAGE_JSON_PATH = join(REPO_ROOT, 'packages/bun-sqlgen/pkg/package.json');

const pkg = await Bun.file(PACKAGE_JSON_PATH).json();
pkg.version = version;
await Bun.write(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
