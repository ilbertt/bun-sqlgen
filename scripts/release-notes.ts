#!/usr/bin/env bun
import { runGitCliff } from 'git-cliff';

const { stdout } = await runGitCliff(
  { latest: true, strip: 'header' },
  { stdio: ['ignore', 'pipe', 'ignore'] },
);
console.log(String(stdout).trimEnd());
