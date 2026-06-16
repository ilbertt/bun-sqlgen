#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { commandTree } from '#command-tree.gen.ts';
import { GenerationFailed } from '#errors.ts';

const EXIT_FAILURE = 1;

const cli = createCli({
  programName: 'bun-sqlgen',
  programDescription: 'Generate TypeScript result types for Bun.sql queries.',
  tree: commandTree,
  errors: { GenerationFailed },
  onError: ({ code, exit }) => {
    if (code === 'GenerationFailed') {
      return exit(EXIT_FAILURE);
    }
  },
});

declare module '@parshjs/core' {
  interface Register {
    cli: typeof cli;
  }
}

await cli.main();
