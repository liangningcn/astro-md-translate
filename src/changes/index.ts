import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

async function sha256(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * File-level change detection used by `--changed-only`. A target is considered
 * changed when it does not exist or its content hash differs from its source.
 */
export async function isChanged(sourcePath: string, targetPath: string): Promise<boolean> {
  const target = resolve(targetPath);
  if (!(await exists(target))) return true;
  const [sourceHash, targetHash] = await Promise.all([
    sha256(resolve(sourcePath)),
    sha256(target),
  ]);
  return sourceHash !== targetHash;
}
