#!/usr/bin/env bun
import { runGitCliff } from 'git-cliff';
import { writeOutput } from '#output.ts';
import { REPO_ROOT } from '#paths.ts';

const { stdout } = await runGitCliff(
  { latest: true, strip: 'header' },
  { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
);
const notes = String(stdout).trimEnd();

await writeOutput({ envVar: 'RELEASE_NOTES_FILE', content: notes });
