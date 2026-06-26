#!/usr/bin/env bun
import { join } from 'node:path';
import { runGitCliff } from 'git-cliff';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const { stdout } = await runGitCliff(
  { bumpedVersion: true },
  { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
);
const version = String(stdout).trim().replace(/^v/, '');

// When run via `bun run --filter`, bun prefixes stdout with a package label,
// so write to the file in `BUMPED_VERSION_FILE` when set; fall back to stdout.
const outFile = process.env.BUMPED_VERSION_FILE;
if (outFile) {
  await Bun.write(outFile, version);
} else {
  console.log(version);
}
