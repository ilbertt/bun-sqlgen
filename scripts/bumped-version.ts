#!/usr/bin/env bun
import { runGitCliff } from 'git-cliff';

const { stdout } = await runGitCliff(
  { bumpedVersion: true },
  { stdio: ['ignore', 'pipe', 'ignore'] },
);
console.log(String(stdout).trim().replace(/^v/, ''));
