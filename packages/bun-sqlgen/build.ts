import { copyFile, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertBuildSuccess,
  cleanDir,
  printBuildOutput,
  setPackageJsonDependencies,
} from '@repo/pack-utils';

const CURRENT_DIR = import.meta.dir;
const ROOT_LICENSE_PATH = join(CURRENT_DIR, '../..', 'LICENSE');

const PKG_DIR = join(CURRENT_DIR, 'pkg');
const DIST_DIR = join(PKG_DIR, 'dist');
const PKG_SRC_DIR = join(PKG_DIR, 'src');
const LICENSE_DESTINATION_PATH = join(PKG_DIR, 'LICENSE');

// Only the CLI is bundled (into a single `dist/cli/main.js` bin). The library is
// shipped as TypeScript source — this is a Bun-only package, so Bun runs the `.ts`
// directly and reads its types from the same files; no build step touches it.
const PACKAGE_ENTRYPOINTS = ['./src/cli/main.ts'];
const LIB_ENTRY = 'index.ts';
const LIB_DIR = 'lib';

// The only deps NOT bundled into the binary — everything else (parsh, zod, and the
// `workspace:` `@repo/bun-sqlgen-core`) is inlined, so the published package declares
// just these:
//   - @electric-sql/pglite — loads its WASM data file from disk at runtime, so it
//     can't be bundled. A regular dependency; used only by the CLI at gen time.
//   - typescript — large and any consumer already has it, so it's a peer dependency
//     (dedupes against the user's install) rather than a bundled ~8 MB.
const EXTERNAL_DEPENDENCIES = ['@electric-sql/pglite', 'typescript'];
const PEER_DEPENDENCIES = ['typescript'];
const RUNTIME_DEPENDENCIES = EXTERNAL_DEPENDENCIES.filter((d) => !PEER_DEPENDENCIES.includes(d));

// Regenerate the parsh command tree first so the bundle can never embed a stale
// one. Reuses the `codegen` script so the args stay single-sourced.
console.log('⚙️  Generating command tree...');
await Bun.$`bun run codegen`;

console.log('🧹 Cleaning output directories...');
await cleanDir({ dir: DIST_DIR });
await cleanDir({ dir: PKG_SRC_DIR });

console.log('🔨 Building CLI...');
const buildResult = await Bun.build({
  entrypoints: PACKAGE_ENTRYPOINTS,
  root: join(CURRENT_DIR, 'src'),
  outdir: DIST_DIR,
  target: 'bun',
  external: EXTERNAL_DEPENDENCIES,
});
assertBuildSuccess({ buildResult });
printBuildOutput({ buildResult });

// Ship the library as source under `pkg/src` — Bun runs it via the `bun` export
// condition. (`.ts` belongs in `src/`, not `dist/`.)
console.log('📚 Copying library source...');
await mkdir(PKG_SRC_DIR, { recursive: true });
await copyFile(join(CURRENT_DIR, 'src', LIB_ENTRY), join(PKG_SRC_DIR, LIB_ENTRY));
await cp(join(CURRENT_DIR, 'src', LIB_DIR), join(PKG_SRC_DIR, LIB_DIR), { recursive: true });

// Emit declarations to `pkg/dist` (the `types` export condition), so editors/tsc and
// the npm "types" badge resolve without parsing the `.ts` source. Relative imports +
// `bun` types only → clean `.d.ts`, no `#subpath` leakage.
console.log('📐 Emitting library types...');
await Bun.$`bun x tsc src/index.ts --declaration --emitDeclarationOnly --outDir ${DIST_DIR} --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types bun`;

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
