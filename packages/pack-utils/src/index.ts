/** biome-ignore-all lint/performance/noBarrelFile: index is the only allowed file where we can export other files */

export { assertBuildSuccess, printBuildOutput } from '#build.ts';
export { cleanDir } from '#files.ts';
export { setPackageJsonDependencies } from '#package-json.ts';
