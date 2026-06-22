import { defineCommand } from '@parshjs/core';
import { generate } from '@repo/bun-sqlgen-core';
import { z } from 'zod';
import { GenerationFailed } from '#cli/errors.ts';

export const command = defineCommand('generate [glob]', {
  description:
    'Generate result types for the Bun.sql queries matching <glob> (e.g. "src/**/*.ts").',
  params: {
    glob: { schema: z.string() },
  },
  options: {
    migrations: {
      schema: z.string(),
      description: 'Migrations directory (required).',
    },
    out: {
      schema: z.string().optional(),
      description: 'Output path for the generated module (default src/queries.gen.d.ts).',
    },
    package: {
      schema: z.string().optional(),
      description: 'Package whose QueryResults registry to augment (default @ilbertt/bun-sqlgen).',
    },
    config: {
      schema: z.string().optional(),
      description: 'Path to sqlgen.config.{ts,js,mjs} (auto-discovered otherwise).',
    },
    dialect: {
      schema: z.enum(['postgres', 'sqlite']).optional(),
      description: 'Database engine to introspect against (default postgres; overrides config).',
    },
    check: {
      schema: z.boolean().optional(),
      description: 'Fail if generated types would change — the CI freshness check.',
    },
  },
  handler: async ({ params, options }) => {
    const result = await generate({
      queries: params.glob,
      migrations: options.migrations,
      out: options.out,
      packageName: options.package,
      configPath: options.config,
      dialect: options.dialect,
      check: options.check,
    });
    // generate() already reported details; throw only to set a non-zero exit (see main.ts).
    if ((options.check && result.changed) || result.failures.length > 0) {
      throw new GenerationFailed();
    }
  },
});
