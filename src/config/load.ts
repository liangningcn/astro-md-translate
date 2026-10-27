import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config, RawConfig } from './types';

/** Neutral placeholder endpoint — never a real provider URL. */
export const DEFAULT_API_URL = 'https://example.com/v1/chat/completions';
export const DEFAULT_MODEL = 'example-model';
export const DEFAULT_SOURCE_LANG = 'en';

/** Neutral default target locales (language codes only, no branding). */
export const DEFAULT_TARGET_LOCALES = [
  'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh',
  'ar', 'tr', 'nl', 'pl', 'vi', 'id', 'th',
];

export const DEFAULT_CONFIG: Config = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  model: DEFAULT_MODEL,
  sourceLang: DEFAULT_SOURCE_LANG,
  targetLocales: DEFAULT_TARGET_LOCALES,
  glossary: 'glossary.yaml',
  dictionary: 'dictionary.json',
  concurrency: 4,
  md: {
    translatableFields: [
      'title', 'subtitle', 'description', 'summary', 'excerpt',
      'headline', 'subheadline', 'buttonText', 'linkText',
      'name', 'label', 'value', 'content', 'alt',
      'event', 'tagline', 'text', 'keywords',
      'emailDescription', 'phoneDescription', 'addressDescription',
      'primaryButtonText', 'secondaryButtonText',
      'items', 'stats', 'timeline', 'faqs', 'features',
      'testimonials', 'services', 'benefits', 'advantages', 'highlights',
    ],
    reservedKeys: [
      'order', '_type', 'author', 'active', 'image', 'isReversed', 'link', 'icon',
      'date', 'slug', 'draft', 'featured', 'locale', 'id', 'type', 'layout',
      'permalink', 'redirect_from', 'redirect_to', 'published', 'robots', 'sitemap',
      'year',
      'head', 'style', 'script', 'class', 'css', 'js', 'meta', 'seo', 'headings',
      'toc', 'nav', 'sidebar', 'footer', 'header', 'body', 'html', 'lang', 'dir',
      'charset', 'viewport', 'http-equiv', 'property', 'rel',
      'href', 'src', 'width', 'height', 'target', 'download',
      'emailValue', 'phoneValue', 'addressValue', 'primaryButtonLink', 'secondaryButtonLink',
      'emailLabel', 'phoneLabel', 'addressLabel',
      'ogImage', 'video', 'file', 'thumbnail', 'whatsappNumber', 'whatsappText',
      'showWhatsApp', 'showCloseButton', 'enabled', 'lastUpdated', 'category', 'module', 'section', 'source',
      'publishDate', 'images',
    ],
    htmlTagPatterns: [
      { pattern: '<br\\s*/?>', placeholder: 'ZBRZ', restore: '<br/>' },
    ],
  },
  json: {
    skipKeys: [
      'logoAlt', 'alt', 'src', 'href', 'link', 'url', 'type', 'id', 'code',
      'icon', 'image', 'logo',
    ],
    keyBlacklist: [
      'id', 'slug', 'url', 'icon', 'image', 'logo', 'video', 'file',
      'thumbnail', 'ogImage', 'src', 'href', 'link', 'type', 'code',
    ],
    placeholderPatterns: [
      '\\{\\{[^}]+\\}\\}',  // {{count}} — must precede the single-brace rule
      '\\{[^}]+\\}',        // {name}
      '%s',
      '\\$\\{[^}]+\\}',     // ${x}
    ],
  },
};

/** Validation error thrown when a config file is malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Load and validate configuration.
 * @param configPath optional explicit path; defaults to
 * `astro-md-translate.config.json` in the current working directory.
 */
export function loadConfig(configPath?: string): Config {
  const path = resolve(configPath ?? 'astro-md-translate.config.json');
  let raw: RawConfig = {};
  try {
    const content = readFileSync(path, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed)) {
      throw new ConfigError('Config root must be a JSON object.');
    }
    raw = parsed as RawConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Missing config is fine — fall back to all defaults.
      raw = {};
    } else {
      throw err instanceof ConfigError
        ? err
        : new ConfigError(`Failed to read config at ${path}: ${(err as Error).message}`);
    }
  }

  return resolveConfig(raw);
}

/** Merge raw (possibly partial) config over defaults and validate. */
export function resolveConfig(raw: RawConfig): Config {
  const md = {
    translatableFields:
      raw.md?.translatableFields ?? DEFAULT_CONFIG.md.translatableFields,
    reservedKeys: raw.md?.reservedKeys ?? DEFAULT_CONFIG.md.reservedKeys,
    htmlTagPatterns: raw.md?.htmlTagPatterns ?? DEFAULT_CONFIG.md.htmlTagPatterns,
  };
  const json = {
    skipKeys: raw.json?.skipKeys ?? DEFAULT_CONFIG.json.skipKeys,
    keyBlacklist: raw.json?.keyBlacklist ?? DEFAULT_CONFIG.json.keyBlacklist,
    placeholderPatterns:
      raw.json?.placeholderPatterns ?? DEFAULT_CONFIG.json.placeholderPatterns,
  };

  if (raw.targetLocales !== undefined && (!Array.isArray(raw.targetLocales) || raw.targetLocales.length === 0)) {
    throw new ConfigError('`targetLocales` must be a non-empty array of language codes.');
  }
  if (raw.concurrency !== undefined && (typeof raw.concurrency !== 'number' || raw.concurrency < 1)) {
    throw new ConfigError('`concurrency` must be a positive number.');
  }

  return {
    apiUrl: raw.apiUrl ?? DEFAULT_CONFIG.apiUrl,
    apiKey: raw.apiKey ?? DEFAULT_CONFIG.apiKey,
    model: raw.model ?? DEFAULT_CONFIG.model,
    sourceLang: raw.sourceLang ?? DEFAULT_CONFIG.sourceLang,
    targetLocales: raw.targetLocales ?? DEFAULT_CONFIG.targetLocales,
    glossary: raw.glossary ?? DEFAULT_CONFIG.glossary,
    dictionary: raw.dictionary ?? DEFAULT_CONFIG.dictionary,
    concurrency: raw.concurrency ?? DEFAULT_CONFIG.concurrency,
    md,
    json,
  };
}
