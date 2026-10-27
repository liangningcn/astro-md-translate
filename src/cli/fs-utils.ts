import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join, extname } from 'node:path';

/** Directory names always excluded when scanning for source documents. */
export const STANDARD_SKIP = [
  'node_modules',
  'dist',
  '.git',
  '.astro',
  '.next',
  'build',
  'out',
  'coverage',
  '.idea',
  '.vscode',
];

/** Recursively collect files whose extension is in `exts`, skipping `skipDirs`. */
export function walkFiles(dir: string, exts: string[], skipDirs: Set<string>): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      results.push(...walkFiles(full, exts, skipDirs));
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

/** Find the source i18n JSON file (`<sourceLang>.json`) under `cwd`. */
export function findJsonSource(cwd: string, sourceLang: string, skipDirs: Set<string>): string | null {
  const name = `${sourceLang}.json`;
  let found: string | null = null;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (entry.name === name && !found) {
        found = full;
      }
    }
  };
  walk(cwd);
  return found;
}

export function readUtf8(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function writeUtf8(path: string, content: string): void {
  writeFileSync(path, content);
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function mtime(path: string): number {
  return statSync(path).mtimeMs;
}
