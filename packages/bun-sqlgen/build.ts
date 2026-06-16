import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertBuildSuccess,
  cleanDir,
  printBuildOutput,
  setPackageJsonDependencies,
} from '@repo/pack-utils';
import packageJson from './package.json' with { type: 'json' };

const CURRENT_DIR = import.meta.dir;
const ROOT_LICENSE_PATH = join(CURRENT_DIR, '../..', 'LICENSE');

const PKG_DIR = join(CURRENT_DIR, 'pkg');
const DIST_DIR = join(PKG_DIR, 'dist');
const LICENSE_DESTINATION_PATH = join(PKG_DIR, 'LICENSE');

const PACKAGE_ENTRYPOINTS = ['./src/main.ts'];

// Externalize published deps (keeps PGlite's WASM out of dist); bundle `workspace:`
// deps since `@repo/bun-sqlgen-core` is never published on its own.
const EXTERNAL_DEPENDENCIES = Object.entries(packageJson.dependencies)
  .filter(([, version]) => !version.startsWith('workspace:'))
  .map(([name]) => name);

// Regenerate the parsh command tree first so the bundle can never embed a stale
// one. Reuses the `codegen` script so the args stay single-sourced.
console.log('⚙️  Generating command tree...');
await Bun.$`bun run codegen`;

console.log('🧹 Cleaning dist directory...');
await cleanDir({ dir: DIST_DIR });

console.log('🔨 Building CLI...');
const buildResult = await Bun.build({
  entrypoints: PACKAGE_ENTRYPOINTS,
  outdir: DIST_DIR,
  target: 'bun',
  external: EXTERNAL_DEPENDENCIES,
});
assertBuildSuccess({ buildResult });
printBuildOutput({ buildResult });

console.log('📄 Copying license...');
await copyFile(ROOT_LICENSE_PATH, LICENSE_DESTINATION_PATH);

console.log('🔄 Updating package.json...');
const internalPackageJsonPath = join(CURRENT_DIR, 'package.json');
const publicPackageJsonPath = join(PKG_DIR, 'package.json');
await setPackageJsonDependencies({
  sourcePackageJsonPath: internalPackageJsonPath,
  targetPackageJsonPath: publicPackageJsonPath,
});

console.log('✅ Done');
