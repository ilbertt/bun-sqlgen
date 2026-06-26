/**
 * Output sink for scripts run via `bun run --filter`, which prefixes stdout
 * with a package label. Write to the file named by `envVar` when it is set;
 * otherwise print to stdout for local runs.
 */
export async function writeOutput({ envVar, content }: { envVar: string; content: string }) {
  const outFile = process.env[envVar];
  if (outFile) {
    await Bun.write(outFile, content);
  } else {
    console.log(content);
  }
}
