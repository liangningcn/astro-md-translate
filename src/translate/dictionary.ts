import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Common-word dictionary: `source text → { langCode → translation }`.
 * Mirrors the original script's pre-translated cache but as a configurable,
 * non-code asset (no real project data bundled).
 */
export type Dictionary = Record<string, Record<string, string>>;

/** Load a dictionary JSON file. Missing files resolve to an empty dictionary. */
export function loadDictionary(path?: string): Dictionary {
  if (!path) return {};
  try {
    const raw = JSON.parse(readFileSync(resolve(path), 'utf-8')) as Dictionary | undefined;
    return raw ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

/** Exact or case-insensitive lookup of a source text for a target language. */
export function lookup(dictionary: Dictionary, text: string, targetLang: string): string | null {
  const trimmed = text.trim();
  const exact = dictionary[trimmed];
  if (exact && exact[targetLang]) return exact[targetLang];
  for (const [key, value] of Object.entries(dictionary)) {
    if (key.toLowerCase() === trimmed.toLowerCase() && value[targetLang]) {
      return value[targetLang];
    }
  }
  return null;
}
