import { defineRootCommand } from '@parshjs/core';

// Anchors the tree; all behavior lives in the `generate` command.
export const command = defineRootCommand({
  options: {},
});
