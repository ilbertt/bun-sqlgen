import rootPackageJson from '../../../package.json' with { type: 'json' };

const CATALOG = rootPackageJson.workspaces.catalog;

export type GenericPackageJson = {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * Write the published manifest's `dependencies`/`peerDependencies` from explicit
 * name lists, resolving each version from the source manifest (including `catalog:`).
 * The build owns which deps are external vs bundled, so it passes only the names
 * that stay external — bundled deps are simply omitted.
 */
export async function setPackageJsonDependencies({
  sourcePackageJsonPath,
  targetPackageJsonPath,
  dependencies,
  peerDependencies = [],
}: {
  sourcePackageJsonPath: string;
  targetPackageJsonPath: string;
  dependencies: string[];
  peerDependencies?: string[];
}) {
  const sourcePackageJson: GenericPackageJson = await Bun.file(sourcePackageJsonPath).json();
  const targetPackageJson: GenericPackageJson = await Bun.file(targetPackageJsonPath).json();
  const sourceDeps = sourcePackageJson.dependencies ?? {};
  const sourcePeerDeps = sourcePackageJson.peerDependencies ?? {};

  const resolve = (names: string[]): Record<string, string> => {
    const entries = names.map((name) => [
      name,
      resolveVersion({ name, version: sourceDeps[name] || sourcePeerDeps[name] }),
    ]);
    return Object.fromEntries(entries);
  };

  const updatedTargetPackageJson = {
    ...targetPackageJson,
    dependencies: resolve(dependencies),
    ...(peerDependencies.length > 0 ? { peerDependencies: resolve(peerDependencies) } : {}),
  };

  // Add trailing newline to make formatter happy
  await Bun.write(targetPackageJsonPath, `${JSON.stringify(updatedTargetPackageJson, null, 2)}\n`);
}

function resolveVersion({ name, version }: { name: string; version: string | undefined }): string {
  if (!version) {
    throw new Error(`Published dependency "${name}" is not declared in the source package.json`);
  }
  if (version.startsWith('workspace:')) {
    throw new Error(`Published dependency "${name}" must not be a workspace dependency`);
  }
  if (version !== 'catalog:') {
    return version;
  }
  const resolved = CATALOG[name as keyof typeof CATALOG];
  if (!resolved) {
    throw new Error(`Dependency "${name}" uses "catalog:" but is not in the root catalog`);
  }
  return resolved;
}
