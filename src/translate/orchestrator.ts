import type { Translator } from '../providers/index';
import type { Glossary } from './glossary';
import { buildGlossaryProtections, missingProtectedTerms } from './glossary';
import type { Dictionary } from './dictionary';
import { lookup } from './dictionary';
import type { Protection } from './protector';
import { Protector, isSymbolOnly } from './protector';
import type { ValidationIssue } from './types';

export interface TranslateTextOptions {
  targetLang: string;
  sourceLang?: string;
  translator: Translator;
  glossary?: Glossary;
  dictionary?: Dictionary;
  /** Additional protections applied before translation (HTML tags, URLs, …). */
  extraProtections?: Protection[];
}

export interface TranslateTextResult {
  text: string;
  issues: ValidationIssue[];
}

/** Max combined length of one provider batch (mirrors the original script). */
export const MAX_CHUNK_SIZE = 4000;

const protector = new Protector();

function buildProtections(options: TranslateTextOptions): Protection[] {
  return [
    ...(options.glossary ? buildGlossaryProtections(options.glossary) : []),
    ...(options.extraProtections ?? []),
  ];
}

async function translateMaskedBatch(
  maskedTexts: string[],
  options: TranslateTextOptions,
): Promise<string[]> {
  const out: string[] = new Array(maskedTexts.length);
  let cursor = 0;
  while (cursor < maskedTexts.length) {
    let size = 0;
    let end = cursor;
    while (end < maskedTexts.length && size + maskedTexts[end].length <= MAX_CHUNK_SIZE) {
      size += maskedTexts[end].length;
      end++;
    }
    if (end === cursor) end = cursor + 1; // force progress on a single oversized text
    const slice = maskedTexts.slice(cursor, end);
    let translated: string[] = [];
    try {
      translated = await options.translator.translate(slice, {
        targetLang: options.targetLang,
        sourceLang: options.sourceLang,
      });
    } catch (err) {
      for (let i = cursor; i < end; i++) {
        out[i] = maskedTexts[i];
      }
      // Record a single issue per failed slice.
      out[cursor] = maskedTexts[cursor];
      cursor = end;
      // Surface the error without losing the rest of the batch loop.
      throw err;
    }
    for (let i = 0; i < slice.length; i++) {
      out[cursor + i] = translated[i] ?? slice[i];
    }
    cursor = end;
  }
  return out;
}

/**
 * Translate many strings while protecting glossary terms and caller-supplied
 * spans. Dictionary hits short-circuit the provider. Masked text is batched by
 * total size and sent to the provider in chunks (preserving the original
 * segmentation strategy). Failures fall back to the original text and are
 * recorded as issues.
 */
export async function translateTexts(
  texts: string[],
  options: TranslateTextOptions,
): Promise<{ texts: string[]; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const protections = buildProtections(options);

  const masked = texts.map((t) => protector.mask(t, protections));
  const result: string[] = new Array(texts.length);

  const needTranslate: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const original = texts[i];
    if (!original || !original.trim() || isSymbolOnly(original)) {
      // Empty, whitespace-only or symbol-only text is never sent to the provider.
      result[i] = original;
      continue;
    }
    if (masked[i].text === original && options.dictionary) {
      const hit = lookup(options.dictionary, original, options.targetLang);
      if (hit) {
        result[i] = hit;
        continue;
      }
    }
    needTranslate.push(i);
  }

  if (needTranslate.length > 0) {
    const batch = needTranslate.map((i) => masked[i].text);
    try {
      const translated = await translateMaskedBatch(batch, options);
      needTranslate.forEach((idx, k) => {
        result[idx] = protector.restore(translated[k], masked[idx].map);
      });
    } catch (err) {
      issues.push({
        rule: 'translate.provider-error',
        level: 'error',
        message: `Translation batch failed, kept originals: ${(err as Error).message}`,
      });
      for (const idx of needTranslate) {
        result[idx] = texts[idx];
      }
    }
  }

  if (options.glossary) {
    for (let i = 0; i < texts.length; i++) {
      for (const term of missingProtectedTerms(texts[i], result[i], options.glossary)) {
        issues.push({
          rule: 'glossary.protected-missing',
          level: 'warn',
          message: `Protected glossary term was not preserved: ${term}`,
        });
      }
    }
  }

  return { texts: result, issues };
}

/** Convenience wrapper translating a single string. */
export async function translateText(
  text: string,
  options: TranslateTextOptions,
): Promise<TranslateTextResult> {
  const { texts, issues } = await translateTexts([text], options);
  return { text: texts[0], issues };
}
