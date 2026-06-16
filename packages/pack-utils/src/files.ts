import { rm } from 'node:fs/promises';

export async function cleanDir({ dir }: { dir: string }) {
  await rm(dir, { recursive: true, force: true });
}
