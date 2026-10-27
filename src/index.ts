/**
 * astro-md-translate — public core API.
 *
 * Two translation pipelines (Markdown documents and i18n JSON files) share a
 * provider-agnostic translator, a glossary, a common-word dictionary, and a
 * fail-safe orchestrator that protects brand names, URLs, placeholders and HTML.
 */

export const VERSION = '0.1.0';

// Configuration
export type {
  Config,
  RawConfig,
  MdConfig,
  JsonConfig,
  HtmlTagPattern,
} from './config/types';
export {
  loadConfig,
  resolveConfig,
  DEFAULT_CONFIG,
  DEFAULT_API_URL,
  DEFAULT_MODEL,
  DEFAULT_SOURCE_LANG,
  DEFAULT_TARGET_LOCALES,
  ConfigError,
} from './config/load';

// Providers
export type { Translator, TranslateOptions } from './providers/index';
export { MockTranslator } from './providers/mock';
export type { MockTranslatorOptions } from './providers/mock';
export { HttpTranslator } from './providers/http';
export type { HttpTranslatorOptions } from './providers/http';

// Glossary & dictionary
export type { Glossary, GlossaryEntry } from './translate/glossary';
export {
  loadGlossary,
  buildGlossaryProtections,
  missingProtectedTerms,
} from './translate/glossary';
export type { Dictionary } from './translate/dictionary';
export { loadDictionary, lookup } from './translate/dictionary';

// Orchestrator
export { translateText, translateTexts, MAX_CHUNK_SIZE } from './translate/orchestrator';
export type { TranslateTextOptions, TranslateTextResult } from './translate/orchestrator';

// Pipelines
export type { MarkdownTranslateOptions, MarkdownTranslateResult, MarkdownAnalysis } from './markdown';
export { translateMarkdown, analyzeMarkdown } from './markdown';
export type { JsonTranslateOptions, JsonTranslateResult, JsonAnalysis } from './json';
export { translateJson, analyzeJson } from './json';

// Change detection
export { isChanged } from './changes';

// Shared types
export type { ValidationIssue, IssueLevel } from './translate/types';

// Internal constants (single source of truth for the package name)
export { PKG_NAME } from './utils/constants';
