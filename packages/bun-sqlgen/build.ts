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
const SRC_DIR = join(CURRENT_DIR, 'src');
const LICENSE_DESTINATION_PATH = join(PKG_DIR, 'LICENSE');

// Types are explicit to make sure the we pick existing dependencies
const RUNTIME_DEPENDENCIES: Extract<
  keyof typeof packageJson.dependencies,
  '@electric-sql/pglite'
>[] = ['@electric-sql/pglite'];
const PEER_DEPENDENCIES = Object.keys(packageJson.peerDependencies);

// Regenerate the parsh command tree first so the bundle can never embed a stale
// one. Reuses the `codegen` script so the args stay single-sourced.
console.log('⚙️  Generating command tree...');
await Bun.$`bun run codegen`;

console.log('🧹 Cleaning dist directory...');
await cleanDir({ dir: DIST_DIR });

console.log('🔨 Building CLI...');
const cliBuildResult = await Bun.build({
  entrypoints: ['./src/cli/main.ts'],
  root: SRC_DIR,
  outdir: DIST_DIR,
  target: 'bun',
  external: [...RUNTIME_DEPENDENCIES, ...PEER_DEPENDENCIES],
});
assertBuildSuccess({ buildResult: cliBuildResult });
printBuildOutput({ buildResult: cliBuildResult });

console.log('📚 Compiling library...');
await Bun.$`bun --bun tsc -p tsconfig.build.json`;

console.log('📄 Copying license...');
await copyFile(ROOT_LICENSE_PATH, LICENSE_DESTINATION_PATH);

console.log('🔄 Updating package.json...');
const internalPackageJsonPath = join(CURRENT_DIR, 'package.json');
const publicPackageJsonPath = join(PKG_DIR, 'package.json');
await setPackageJsonDependencies({
  sourcePackageJsonPath: internalPackageJsonPath,
  targetPackageJsonPath: publicPackageJsonPath,
  dependencies: RUNTIME_DEPENDENCIES,
  peerDependencies: PEER_DEPENDENCIES,
});

console.log('✅ Done');
