#!/usr/bin/env bun
import { join } from 'node:path';
import { runGitCliff } from 'git-cliff';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const { stdout } = await runGitCliff(
  { latest: true, strip: 'header' },
  { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
);
const notes = String(stdout).trimEnd();

// When run via `bun run --filter`, bun prefixes stdout with a package label,
// so write to the file in `RELEASE_NOTES_FILE` when set; fall back to stdout.
const outFile = process.env.RELEASE_NOTES_FILE;
if (outFile) {
  await Bun.write(outFile, notes);
} else {
  console.log(notes);
}
