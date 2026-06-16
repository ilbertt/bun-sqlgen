import rootPackageJson from '../../../package.json' with { type: 'json' };

const CATALOG = rootPackageJson.workspaces.catalog;

export type GenericPackageJson = {
  name: string;
  dependencies: Record<string, string>;
};
type DependencyEntry = [string, string];

export async function setPackageJsonDependencies({
  sourcePackageJsonPath,
  targetPackageJsonPath,
}: {
  sourcePackageJsonPath: string;
  targetPackageJsonPath: string;
}) {
  const sourcePackageJson: GenericPackageJson = await Bun.file(sourcePackageJsonPath).json();
  const targetPackageJson: GenericPackageJson = await Bun.file(targetPackageJsonPath).json();

  const updatedTargetPackageJson = {
    ...targetPackageJson,
    dependencies: resolvePublishedDependencies(
      Object.entries(sourcePackageJson.dependencies || {}),
    ),
  };

  // Add trailing newline to make formatter happy
  await Bun.write(targetPackageJsonPath, `${JSON.stringify(updatedTargetPackageJson, null, 2)}\n`);
}

function resolvePublishedDependencies(
  entries: DependencyEntry[],
): GenericPackageJson['dependencies'] {
  let result = entries;
  result = removeWorkspaceDependencies(result);
  result = resolveCatalogDependencies(result);
  return Object.fromEntries(result);
}

function resolveCatalogDependencies(entries: DependencyEntry[]): DependencyEntry[] {
  return entries.map(([name, version]) => {
    if (version !== 'catalog:') {
      return [name, version];
    }
    const catalogDepName = name as keyof typeof CATALOG;
    const resolved = CATALOG[catalogDepName];
    if (!resolved) {
      throw new Error(`Dependency "${name}" uses "catalog:" but is not in the root catalog`);
    }
    return [name, resolved];
  });
}

function removeWorkspaceDependencies(entries: DependencyEntry[]): DependencyEntry[] {
  return entries.filter(([_, version]) => !version.startsWith('workspace:'));
}
