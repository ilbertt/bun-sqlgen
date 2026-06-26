#!/usr/bin/env bun
import { join } from 'node:path';

const version = process.argv[2];
if (!version) {
  throw new Error('usage: bun src/set-version.ts <version>');
}

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'packages/bun-sqlgen/pkg/package.json');

const pkg = await Bun.file(PACKAGE_JSON_PATH).json();
pkg.version = version;
await Bun.write(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
