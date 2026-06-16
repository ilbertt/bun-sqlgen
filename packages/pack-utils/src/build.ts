const BYTES_PER_KB = 1024;

export function assertBuildSuccess({ buildResult }: { buildResult: Bun.BuildOutput }) {
  if (!buildResult.success) {
    console.error('❌ Build failed:', JSON.stringify(buildResult, null, 2));
    process.exit(1);
  }
}

export function printBuildOutput({ buildResult }: { buildResult: Bun.BuildOutput }) {
  const currentDir = process.cwd();

  const entrypoints = buildResult.outputs
    .filter((o) => o.kind === 'entry-point')
    .map(
      (o) => `${o.path.replace(`${currentDir}/`, '')} (${(o.size / BYTES_PER_KB).toFixed(1)} kB)`,
    );
  console.log(`📦 Built files:\n${entrypoints.map((p) => `  ✓ ${p}`).join('\n')}`);
}
