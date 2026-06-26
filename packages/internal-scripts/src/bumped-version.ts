#!/usr/bin/env bun
import { runGitCliff } from 'git-cliff';
import { writeOutput } from '#output.ts';
import { REPO_ROOT } from '#paths.ts';

const { stdout } = await runGitCliff(
  { bumpedVersion: true },
  { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
);
const version = String(stdout).trim().replace(/^v/, '');

await writeOutput({ envVar: 'BUMPED_VERSION_FILE', content: version });
