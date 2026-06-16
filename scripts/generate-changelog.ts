#!/usr/bin/env bun
import { runGitCliff } from 'git-cliff';

const CHANGELOG_FILE = 'CHANGELOG.md';

await runGitCliff({ bump: 'auto', unreleased: true, prepend: CHANGELOG_FILE });
