#!/usr/bin/env bun
import { join } from 'node:path';
import { runGitCliff } from 'git-cliff';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const CHANGELOG_FILE = 'CHANGELOG.md';

await runGitCliff({ bump: 'auto', unreleased: true, prepend: CHANGELOG_FILE }, { cwd: REPO_ROOT });
