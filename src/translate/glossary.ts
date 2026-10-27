import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Protection } from './protector';
import { escapeRegExp } from './protector';

/**
 * Glossary entry. `term` is matched in source text; if `protected` is not false
 * it is masked during translation and restored to `replacement` (defaults to the
 * original `term`). This is how trademark behaviour (e.g. appending ®) is
 * expressed without hardcoding brand names in source code.
 */
export interface GlossaryEntry {
  term: string;
  replacement?: string;
  /** When false the term is translated normally. Defaults to true. */
  protected?: boolean;
  /** Optional preferred translation for the term itself. */
  preferred?: string;
}

export interface Glossary {
  entries: GlossaryEntry[];
}

/**
 * Load a glossary file (YAML or JSON; YAML is a superset so both parse). Missing
 * files resolve to an empty glossary.
 */
export function loadGlossary(path?: string): Glossary {
  if (!path) return { entries: [] };
  try {
    const raw = parseYaml(readFileSync(resolve(path), 'utf-8')) as
      | GlossaryEntry[]
      | Glossary
      | undefined;
    if (Array.isArray(raw)) return { entries: raw };
    if (raw && Array.isArray(raw.entries)) return raw;
    return { entries: [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
    throw err;
  }
}

/** Build protection rules for all protected glossary entries. */
export function buildGlossaryProtections(glossary: Glossary): Protection[] {
  const protections: Protection[] = [];
  for (const entry of glossary.entries) {
    if (entry.protected === false) continue;
    const restore = entry.replacement ?? entry.term;
    protections.push({
      id: `glossary:${entry.term}`,
      regex: new RegExp(`\\b${escapeRegExp(entry.term)}(?:®)?\\b`, 'gi'),
      restore: () => restore,
    });
  }
  return protections;
}

/**
 * Verify that protected glossary terms survived translation. Returns the list of
 * terms that are missing from the translated text (empty when all preserved).
 */
export function missingProtectedTerms(original: string, translated: string, glossary: Glossary): string[] {
  const missing: string[] = [];
  for (const entry of glossary.entries) {
    if (entry.protected === false) continue;
    const expected = entry.replacement ?? entry.term;
    if (!translated.includes(expected) && original.includes(entry.term)) {
      missing.push(entry.term);
    }
  }
  return missing;
}
