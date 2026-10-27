/**
 * Configuration types for astro-md-translate.
 *
 * Config is loaded from a JSON file (default `astro-md-translate.config.json`).
 * Every field has a neutral default so the package works out of the box with a
 * mock translator and no real API credentials.
 */

/** A single HTML-tag protection rule (regex source → restore string). */
export interface HtmlTagPattern {
  /** Regular-expression source matched against Markdown text. */
  pattern: string;
  /** Placeholder token used while translating (kept internal). */
  placeholder: string;
  /** String restored in place of a matched tag. */
  restore: string;
}

/** Markdown-specific translation configuration. */
export interface MdConfig {
  /** Frontmatter field names whose string values should be translated. */
  translatableFields: string[];
  /** Frontmatter keys (and nested parent keys) whose values are never translated. */
  reservedKeys: string[];
  /** Extra HTML tags to mask during translation. */
  htmlTagPatterns: HtmlTagPattern[];
}

/** i18n JSON-specific translation configuration. */
export interface JsonConfig {
  /** Object keys whose string values must never be translated. */
  skipKeys: string[];
  /** Object keys whose values are treated as non-translatable (alias of skipKeys). */
  keyBlacklist: string[];
  /** Regular-expression sources that identify interpolation placeholders. */
  placeholderPatterns: string[];
}

/** Fully resolved, validated configuration. */
export interface Config {
  /** OpenAI-compatible chat completions endpoint. */
  apiUrl: string;
  /** API key (sent as `Authorization: Bearer`). Leave empty for mock use. */
  apiKey: string;
  /** Model identifier passed to the provider. */
  model: string;
  /** Source language code. */
  sourceLang: string;
  /** Target language codes to translate into. */
  targetLocales: string[];
  /** Path to the glossary file (JSON). */
  glossary: string;
  /** Path to the common-word dictionary file (JSON). */
  dictionary: string;
  /** Max concurrent translation batches. */
  concurrency: number;
  /** Markdown pipeline options. */
  md: MdConfig;
  /** JSON pipeline options. */
  json: JsonConfig;
}

/** Partial config as written by users (everything optional). */
export interface RawConfig {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  sourceLang?: string;
  targetLocales?: string[];
  glossary?: string;
  dictionary?: string;
  concurrency?: number;
  md?: Partial<MdConfig>;
  json?: Partial<JsonConfig>;
}
