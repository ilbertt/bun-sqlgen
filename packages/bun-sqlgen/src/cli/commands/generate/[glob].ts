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
      description:
        'Package whose QueryResults registry to augment (default @ilbertt/bun-sqlgen). You can ignore this — it exists for this repo’s own examples.',
    },
    config: {
      schema: z.string().optional(),
      description: 'Path to sqlgen.config.{ts,js,mjs} (auto-discovered otherwise).',
    },
    'check-queries': {
      schema: z.boolean().optional(),
      description: 'Fail if any discovered query does not plan against the schema. Writes nothing.',
    },
    'check-stale': {
      schema: z.boolean().optional(),
      description: 'Fail if the committed generated types are out of date. Writes nothing.',
    },
    dialect: {
      schema: z.enum(['postgres', 'sqlite']).optional(),
      description: 'Database engine to introspect against (default postgres; overrides config).',
    },
    check: {
      schema: z.boolean().optional(),
      description: 'Run all checks (queries + stale types); writes nothing — the CI default.',
    },
  },
  handler: async ({ params, options }) => {
    // `--check` is the umbrella that runs every check.
    const checkQueries = options['check-queries'] || options.check;
    const checkStale = options['check-stale'] || options.check;
    const result = await generate({
      queries: params.glob,
      migrations: options.migrations,
      out: options.out,
      packageName: options.package,
      configPath: options.config,
      dialect: options.dialect,
      checkQueries,
      checkStale,
    });
    // generate() already reported details; throw only to set a non-zero exit (see main.ts).
    if ((checkStale && result.changed) || result.failures.length > 0) {
      throw new GenerationFailed();
    }
  },
});
