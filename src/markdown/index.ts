import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { stringify } from 'yaml';
import type { Config } from '../config/types';
import type { Translator } from '../providers/index';
import type { Glossary } from '../translate/glossary';
import { missingProtectedTerms } from '../translate/glossary';
import type { Dictionary } from '../translate/dictionary';
import { translateTexts } from '../translate/orchestrator';
import type { Protection } from '../translate/protector';
import {
  buildPlaceholderCounter,
  buildPlaceholderProtections,
  escapeRegExp,
  hasUnrestoredMask,
  isSymbolOnly,
} from '../translate/protector';
import type { ValidationIssue } from '../translate/types';

export interface MarkdownTranslateOptions {
  config: Config;
  translator: Translator;
  targetLang: string;
  sourceLang?: string;
  glossary?: Glossary;
  dictionary?: Dictionary;
}

export interface MarkdownTranslateResult {
  content: string;
  issues: ValidationIssue[];
}

/** Build protection rules for Markdown text: HTML tags + URLs + interpolation placeholders. */
function buildMdProtections(config: Config): Protection[] {
  const protections: Protection[] = config.md.htmlTagPatterns.map((p) => ({
    id: `html:${p.placeholder}`,
    regex: new RegExp(p.pattern, 'gi'),
    restore: () => p.restore,
  }));
  protections.push({
    id: 'url',
    regex: /https?:\/\/[^\s"'<>()[\]]+/gi,
    restore: (m) => m,
  });
  // Candidate 1 (adopted in 0.1.0): reuse JSON's placeholder masking on Markdown
  // translatable text. Only config `placeholderPatterns` matches are masked — no
  // fuzzy matching — to avoid conflicts with Markdown syntax (esp. `{{`).
  protections.push(...buildPlaceholderProtections(config.json.placeholderPatterns));
  return protections;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

interface TranslateContext {
  config: Config;
  translator: Translator;
  targetLang: string;
  sourceLang?: string;
  glossary?: Glossary;
  dictionary?: Dictionary;
  protections: Protection[];
  issues: ValidationIssue[];
}

async function translateValue(
  value: unknown,
  parentKey: string,
  ctx: TranslateContext,
): Promise<unknown> {
  if (typeof value === 'string') {
    if (ctx.config.md.reservedKeys.includes(parentKey)) return value;
    const { texts, issues } = await translateTexts([value], {
      targetLang: ctx.targetLang,
      sourceLang: ctx.sourceLang,
      translator: ctx.translator,
      glossary: ctx.glossary,
      dictionary: ctx.dictionary,
      extraProtections: ctx.protections,
    });
    ctx.issues.push(...issues);
    return texts[0];
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        out.push(await translateValue(item, parentKey, ctx));
      } else if (item && typeof item === 'object') {
        out.push(await translateObject(item as unknown as Record<string, unknown>, ctx));
      } else {
        out.push(item);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    return translateObject(value as unknown as Record<string, unknown>, ctx);
  }
  return value;
}

async function translateObject(obj: Record<string, unknown>, ctx: TranslateContext): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (ctx.config.md.reservedKeys.includes(key)) {
      result[key] = value;
    } else if (ctx.config.md.translatableFields.includes(key)) {
      result[key] = await translateValue(value, key, ctx);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = await translateObject(value as Record<string, unknown>, ctx);
    } else if (Array.isArray(value)) {
      result[key] = await translateValue(value, key, ctx);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function collectTextNodes(tree: unknown): Array<{ node: { value: string }; parent: unknown }> {
  const nodes: Array<{ node: { value: string }; parent: unknown }> = [];
  visit(tree as never, 'text', (node: { value: string }, _index: number, parent: unknown) => {
    nodes.push({ node, parent });
  });
  return nodes;
}

function isTranslatableText(value: string, parent: unknown): boolean {
  if (!value.trim()) return false;
  if (/^[\s\-=*#]+$/.test(value)) return false;
  if (value.trim() === '®') return false;
  if (
    parent &&
    typeof parent === 'object' &&
    (parent as { type?: string }).type === 'link'
  ) {
    if (value.includes('@') || /^[\w.-]+@[\w.-]+\.\w+$/.test(value)) return false;
  }
  return true;
}

function linkUrls(tree: unknown): string[] {
  const urls: string[] = [];
  visit(tree as never, 'link', (node: { url?: string }) => {
    if (node.url) urls.push(node.url);
  });
  return urls;
}

function headingSlugs(tree: unknown): Set<string> {
  const slugs = new Set<string>();
  visit(tree as never, 'heading', (node: { children?: Array<{ value?: string }> }) => {
    const text = (node.children ?? [])
      .map((c) => c.value ?? '')
      .join('');
    if (text.trim()) slugs.add(slugify(text));
  });
  return slugs;
}

function anchorTargets(tree: unknown): string[] {
  const targets: string[] = [];
  visit(tree as never, 'link', (node: { url?: string }) => {
    if (node.url && node.url.startsWith('#')) targets.push(node.url.slice(1));
  });
  return targets;
}

function countFences(body: string): number {
  return (body.match(/```/g) ?? []).length;
}

interface ImageNode {
  type: string;
  alt?: string | null;
}

function collectImageNodes(tree: unknown): ImageNode[] {
  const out: ImageNode[] = [];
  visit(tree as never, (node: ImageNode) => {
    if (node.type === 'image' || node.type === 'imageReference') out.push(node);
  });
  return out;
}

/**
 * If the whole alt matches a protected glossary term, return the value to keep
 * (the `replacement`, else the term) so the provider is never called for it.
 */
function protectedAltValue(alt: string, glossary?: Glossary): string | null {
  if (!glossary) return null;
  const trimmed = alt.trim();
  for (const entry of glossary.entries) {
    if (entry.protected === false) continue;
    if (entry.term.toLowerCase() === trimmed.toLowerCase()) {
      return entry.replacement ?? entry.term;
    }
  }
  return null;
}

function urlsIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s"'<>()[\]]+/gi) ?? []).sort();
}

/** True when an alt is worth translating (non-empty, not symbol-only). */
function isTranslatableAlt(alt: string | null | undefined): alt is string {
  return typeof alt === 'string' && alt.trim() !== '' && !isSymbolOnly(alt);
}

function countMatches(text: string, regexes: RegExp[]): number {
  let total = 0;
  for (const re of regexes) {
    const m = text.match(re);
    if (m) total += m.length;
  }
  return total;
}

function protectionsFor(
  text: string,
  placeholderRegexes: RegExp[],
  glossaryRegexes: RegExp[],
): { placeholder: boolean; glossary: boolean } {
  return {
    placeholder: countMatches(text, placeholderRegexes) > 0,
    glossary: countMatches(text, glossaryRegexes) > 0,
  };
}

function collectFrontmatterTexts(
  obj: unknown,
  reserved: string[],
  translatable: string[],
  out: string[],
): void {
  const fromValue = (value: unknown, parentKey: string): void => {
    if (typeof value === 'string') {
      if (!reserved.includes(parentKey)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) fromValue(item, parentKey);
      return;
    }
    if (value && typeof value === 'object') {
      fromObject(value as Record<string, unknown>);
    }
  };
  const fromObject = (o: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(o)) {
      if (reserved.includes(k)) continue;
      if (translatable.includes(k)) {
        fromValue(v, k);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        fromObject(v as Record<string, unknown>);
      } else if (Array.isArray(v)) {
        fromValue(v, k);
      }
    }
  };
  if (obj && typeof obj === 'object') fromObject(obj as Record<string, unknown>);
}

/** Per-file statistics for `--dry-run` and `check`, without performing translation. */
export interface MarkdownAnalysis {
  segments: number;
  codeBlocks: number;
  inlineCode: number;
  linkUrls: number;
  placeholderHits: number;
  glossaryHits: number;
  segmentProtections: { placeholder: boolean; glossary: boolean }[];
  balancedFences: boolean;
}

/** Analyze a Markdown document: count translatable segments and protection hits. */
export function analyzeMarkdown(
  content: string,
  opts: { config: Config; glossary?: Glossary },
): MarkdownAnalysis {
  const { config, glossary } = opts;
  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  const placeholderRegexes = [buildPlaceholderCounter(config.json.placeholderPatterns)];
  const glossaryRegexes = glossary
    ? glossary.entries
        .filter((e) => e.protected !== false)
        .map((e) => new RegExp(`\\b${escapeRegExp(e.term)}(?:®)?\\b`, 'gi'))
    : [];

  const segmentProtections: { placeholder: boolean; glossary: boolean }[] = [];
  let segments = 0;
  let placeholderHits = 0;
  let glossaryHits = 0;

  const fmTexts: string[] = [];
  collectFrontmatterTexts(frontmatter, config.md.reservedKeys, config.md.translatableFields, fmTexts);
  for (const t of fmTexts) {
    segments++;
    segmentProtections.push(protectionsFor(t, placeholderRegexes, glossaryRegexes));
    placeholderHits += countMatches(t, placeholderRegexes);
    glossaryHits += countMatches(t, glossaryRegexes);
  }

  const tree: unknown = unified().use(remarkParse).use(remarkGfm).parse(body);
  const nodes = collectTextNodes(tree);
  let inlineCode = 0;
  visit(tree as never, 'inlineCode', () => {
    inlineCode++;
  });
  const linkUrls = new Set<string>();
  visit(tree as never, 'link', (node: { url?: string }) => {
    if (node.url) linkUrls.add(node.url);
  });

  for (const { node, parent } of nodes) {
    if (!isTranslatableText(node.value, parent)) continue;
    segments++;
    segmentProtections.push(protectionsFor(node.value, placeholderRegexes, glossaryRegexes));
    placeholderHits += countMatches(node.value, placeholderRegexes);
    glossaryHits += countMatches(node.value, glossaryRegexes);
  }

  // Image alt text is its own translatable segment. Paths, reference
  // identifiers and titles are protected and never counted as segments.
  for (const node of collectImageNodes(tree)) {
    if (!isTranslatableAlt(node.alt)) continue;
    segments++;
    segmentProtections.push(protectionsFor(node.alt, placeholderRegexes, glossaryRegexes));
    placeholderHits += countMatches(node.alt, placeholderRegexes);
    glossaryHits += countMatches(node.alt, glossaryRegexes);
  }

  return {
    segments,
    codeBlocks: Math.floor(countFences(body) / 2),
    inlineCode,
    linkUrls: linkUrls.size,
    placeholderHits,
    glossaryHits,
    segmentProtections,
    balancedFences: countFences(body) % 2 === 0,
  };
}

/**
 * Translate a Markdown document: frontmatter (selected fields) + body text nodes,
 * while protecting code, inline code, links, HTML, URLs and glossary terms.
 */
export async function translateMarkdown(
  content: string,
  options: MarkdownTranslateOptions,
): Promise<MarkdownTranslateResult> {
  const { config, translator, targetLang } = options;
  const issues: ValidationIssue[] = [];
  const protections = buildMdProtections(config);
  const ctx: TranslateContext = {
    config,
    translator,
    targetLang,
    sourceLang: options.sourceLang,
    glossary: options.glossary,
    dictionary: options.dictionary,
    protections,
    issues,
  };

  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  const translatedFrontmatter = await translateObject(frontmatter, ctx);
  const frontmatterYaml = stringify(translatedFrontmatter, { lineWidth: -1 });

  const parseProcessor = unified().use(remarkParse).use(remarkGfm);
  const stringifyProcessor = unified().use(remarkGfm).use(remarkStringify);

  const originalTree: unknown = parseProcessor.parse(body);
  const translatedTree: unknown = parseProcessor.parse(body);

  const originalNodes = collectTextNodes(originalTree);
  const translatedNodes = collectTextNodes(translatedTree);
  const values: string[] = [];
  const keepOriginal: boolean[] = [];
  originalNodes.forEach(({ node, parent }) => {
    const translatable = isTranslatableText(node.value, parent);
    keepOriginal.push(!translatable);
    values.push(node.value);
  });

  // Translate, preserving original for non-translatable nodes.
  const { texts, issues: bodyIssues } = await translateTexts(values, {
    targetLang,
    sourceLang: options.sourceLang,
    translator,
    glossary: options.glossary,
    dictionary: options.dictionary,
    extraProtections: protections,
  });
  issues.push(...bodyIssues);

  for (let i = 0; i < translatedNodes.length; i++) {
    translatedNodes[i].node.value = keepOriginal[i] ? values[i] : texts[i];
  }

  // ---- Image alt translation ----
  // Only the alt text is translated: the image path/URL, the reference
  // identifier (`[ref]`) and the `title` attribute are never touched.
  const imageNodes = collectImageNodes(translatedTree);
  const altValues: string[] = [];
  const altTargets: ImageNode[] = [];
  for (const node of imageNodes) {
    if (!isTranslatableAlt(node.alt)) continue;
    const protectedValue = protectedAltValue(node.alt, options.glossary);
    if (protectedValue !== null) {
      node.alt = protectedValue;
      continue;
    }
    altValues.push(node.alt);
    altTargets.push(node);
  }

  if (altValues.length > 0) {
    const { texts: altTexts, issues: altIssues } = await translateTexts(altValues, {
      targetLang,
      sourceLang: options.sourceLang,
      translator,
      glossary: options.glossary,
      dictionary: options.dictionary,
      extraProtections: protections,
    });
    issues.push(...altIssues);
    altTargets.forEach((node, i) => {
      const original = altValues[i];
      const translated = altTexts[i];
      const valid =
        translated.trim() !== '' &&
        !hasUnrestoredMask(translated) &&
        JSON.stringify(urlsIn(original)) === JSON.stringify(urlsIn(translated));
      if (!valid) {
        node.alt = original;
        issues.push({
          rule: 'md.image-alt-invalid',
          level: 'warn',
          message: `Image alt translation rejected; kept the original alt.`,
        });
        return;
      }
      node.alt = translated;
    });
  }

  const translatedBody = stringifyProcessor.stringify(translatedTree as never) as string;
  const result = `---\n${frontmatterYaml}---\n${translatedBody}`;

  // ---- Validation ----
  if (countFences(body) !== countFences(translatedBody)) {
    issues.push({
      rule: 'md.code-block-count',
      level: 'error',
      message: 'Fenced code block count changed during translation.',
    });
  }

  const originalUrls = linkUrls(originalTree).sort();
  const translatedUrls = linkUrls(translatedTree).sort();
  if (JSON.stringify(originalUrls) !== JSON.stringify(translatedUrls)) {
    issues.push({
      rule: 'md.link-url-changed',
      level: 'error',
      message: 'A link URL was altered during translation.',
    });
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

  const slugs = headingSlugs(translatedTree);
  for (const target of anchorTargets(translatedTree)) {
    if (!slugs.has(target)) {
      issues.push({
        rule: 'md.anchor-broken',
        level: 'warn',
        message: `Anchor link target "#${target}" has no matching heading after translation.`,
      });
    }
  }

  return { content: result, issues };
}
