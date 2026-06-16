import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertBuildSuccess,
  cleanDir,
  printBuildOutput,
  setPackageJsonDependencies,
} from '@repo/pack-utils';
import { $ } from 'bun';

const CURRENT_DIR = import.meta.dir;
const ROOT_LICENSE_PATH = join(CURRENT_DIR, '../..', 'LICENSE');

const PKG_DIR = join(CURRENT_DIR, 'pkg');
const DIST_DIR = join(PKG_DIR, 'dist');
const LICENSE_DESTINATION_PATH = join(PKG_DIR, 'LICENSE');

const PACKAGE_ENTRYPOINTS = ['./src/index.ts'];

console.log('🧹 Cleaning dist directory...');
await cleanDir({ dir: DIST_DIR });

console.log('🔨 Building plugin...');
const buildResult = await Bun.build({
  entrypoints: PACKAGE_ENTRYPOINTS,
  outdir: DIST_DIR,
});
assertBuildSuccess({ buildResult });
printBuildOutput({ buildResult });

console.log('📝 Generating type declarations...');
await $`bun --bun tsc --project tsconfig.build.json`;

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
