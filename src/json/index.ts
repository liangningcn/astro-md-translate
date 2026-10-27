import type { Config } from '../config/types';
import type { Translator } from '../providers/index';
import type { Glossary } from '../translate/glossary';
import { missingProtectedTerms } from '../translate/glossary';
import type { Dictionary } from '../translate/dictionary';
import { buildGlossaryProtections } from '../translate/glossary';
import { translateTexts } from '../translate/orchestrator';
import type { Protection } from '../translate/protector';
import { buildPlaceholderCounter, escapeRegExp, isSymbolOnly } from '../translate/protector';
import type { ValidationIssue } from '../translate/types';

export interface JsonTranslateOptions {
  config: Config;
  translator: Translator;
  targetLang: string;
  sourceLang?: string;
  glossary?: Glossary;
  dictionary?: Dictionary;
}

export interface JsonTranslateResult {
  content: string;
  issues: ValidationIssue[];
}

function buildJsonProtections(config: Config, glossary?: Glossary): Protection[] {
  const protections: Protection[] = config.json.placeholderPatterns.map((pattern, i) => ({
    id: `placeholder:${i}`,
    regex: new RegExp(pattern, 'g'),
    restore: (m) => m,
  }));
  if (glossary) protections.push(...buildGlossaryProtections(glossary));
  return protections;
}

function collectValues(node: unknown, parentKey: string, skipKeys: string[], out: string[]): void {
  if (typeof node === 'string') {
    if (!skipKeys.includes(parentKey)) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectValues(item, parentKey, skipKeys, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectValues(value, key, skipKeys, out);
    }
  }
}

function rebuild(
  node: unknown,
  parentKey: string,
  skipKeys: string[],
  map: Map<string, string>,
): unknown {
  if (typeof node === 'string') {
    if (skipKeys.includes(parentKey)) return node;
    return map.get(node) ?? node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => rebuild(item, parentKey, skipKeys, map));
  }
  if (node && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = rebuild(value, key, skipKeys, map);
    }
    return result;
  }
  return node;
}

function keySet(obj: unknown, prefix = ''): string[] {
  const keys: string[] = [];
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      keys.push(path);
      keys.push(...keySet(v, path));
    }
  }
  return keys.sort();
}

function placeholderCounts(text: string, patterns: RegExp[]): Record<string, number> {
  const counts: Record<string, number> = {};
  patterns.forEach((re, i) => {
    const matches = text.match(re);
    counts[`p${i}`] = matches ? matches.length : 0;
  });
  return counts;
}

/**
 * Translate an i18n JSON document. Object keys are never translated; only string
 * values (excluding skip-listed keys) are. Interpolation placeholders and ICU
 * skeletons are protected, and the output preserves key order and indentation.
 */
export async function translateJson(
  content: string,
  options: JsonTranslateOptions,
): Promise<JsonTranslateResult> {
  const { config, translator, targetLang } = options;
  const issues: ValidationIssue[] = [];
  const skipKeys = [...new Set([...config.json.skipKeys, ...config.json.keyBlacklist])];
  const protections = buildJsonProtections(config, options.glossary);

  let sourceJson: unknown;
  try {
    sourceJson = JSON.parse(content);
  } catch (err) {
    return {
      content,
      issues: [
        { rule: 'json.parse', level: 'error', message: `Invalid JSON input: ${(err as Error).message}` },
      ],
    };
  }

  const values: string[] = [];
  collectValues(sourceJson, '', skipKeys, values);
  const unique = Array.from(new Set(values));

  const { texts, issues: translateIssues } = await translateTexts(unique, {
    targetLang,
    sourceLang: options.sourceLang,
    translator,
    glossary: options.glossary,
    dictionary: options.dictionary,
    extraProtections: protections,
  });
  issues.push(...translateIssues);

  const map = new Map<string, string>();
  unique.forEach((value, i) => map.set(value, texts[i]));

  const translatedJson = rebuild(sourceJson, '', skipKeys, map);
  const result = JSON.stringify(translatedJson, null, 2);

  // ---- Validation ----
  if (keySet(sourceJson) !== undefined) {
    const sourceKeys = keySet(sourceJson);
    const translatedKeys = keySet(translatedJson);
    if (JSON.stringify(sourceKeys) !== JSON.stringify(translatedKeys)) {
      issues.push({
        rule: 'json.key-set-changed',
        level: 'error',
        message: 'JSON key set changed during translation.',
      });
    }
  }

  const placeholderRegexes = config.json.placeholderPatterns.map((p) => new RegExp(p, 'g'));
  for (const value of unique) {
    const translated = map.get(value) ?? value;
    const before = placeholderCounts(value, placeholderRegexes);
    const after = placeholderCounts(translated, placeholderRegexes);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      issues.push({
        rule: 'json.placeholder-changed',
        level: 'error',
        message: `Interpolation placeholder counts changed for a value.`,
      });
    }
  }

  if (options.glossary) {
    for (const term of missingProtectedTerms(content, result, options.glossary)) {
      issues.push({
        rule: 'glossary.protected-missing',
        level: 'warn',
        message: `Protected glossary term was not preserved: ${term}`,
      });
    }
  }

  return { content: result, issues };
}

/** Per-file statistics for `--dry-run` and `check`, without performing translation. */
export interface JsonAnalysis {
  /** Whether the file parsed as valid JSON. */
  valid: boolean;
  /** Number of translatable string leaves (excluding skip-listed keys). */
  segments: number;
  placeholderHits: number;
  glossaryHits: number;
  /** True if any string value contains an ICU `plural`/`select` skeleton. */
  icu: boolean;
}

function countMatches(text: string, regexes: RegExp[]): number {
  let total = 0;
  for (const re of regexes) {
    const m = text.match(re);
    if (m) total += m.length;
  }
  return total;
}

/** Analyze an i18n JSON document: count translatable segments and protection hits. */
export function analyzeJson(
  content: string,
  opts: { config: Config; glossary?: Glossary },
): JsonAnalysis {
  const { config, glossary } = opts;
  const glossaryRegexes = glossary
    ? glossary.entries
        .filter((e) => e.protected !== false)
        .map((e) => new RegExp(`\\b${escapeRegExp(e.term)}(?:®)?\\b`, 'gi'))
    : [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, segments: 0, placeholderHits: 0, glossaryHits: 0, icu: false };
  }

  const skipKeys = [...new Set([...config.json.skipKeys, ...config.json.keyBlacklist])];
  const values: string[] = [];
  collectValues(parsed, '', skipKeys, values);
  // Only count strings the pipeline would actually translate.
  const translatable = values.filter((v) => v.trim() !== '' && !isSymbolOnly(v));

  const placeholderCounter = [buildPlaceholderCounter(config.json.placeholderPatterns)];
  let placeholderHits = 0;
  let glossaryHits = 0;
  let icu = false;
  for (const v of translatable) {
    placeholderHits += countMatches(v, placeholderCounter);
    glossaryHits += countMatches(v, glossaryRegexes);
    if (/,\s*(plural|select)\s*,/.test(v)) icu = true;
  }

  return { valid: true, segments: translatable.length, placeholderHits, glossaryHits, icu };
}
