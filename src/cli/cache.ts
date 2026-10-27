import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CACHE_FILE = '.astro-md-translate-cache.json';

/** SHA-256 of file content, used for `--changed-only` detection (phase-2 primitive). */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function loadCache(cwd: string): Record<string, string> {
  const path = join(cwd, CACHE_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveCache(cwd: string, cache: Record<string, string>): void {
  writeFileSync(join(cwd, CACHE_FILE), JSON.stringify(cache, null, 2));
}
