import { resolve, relative, join, dirname, basename } from 'node:path';
import type { Config } from '../config/types';
import type { Translator } from '../providers/index';
import { loadConfig } from '../config/load';
import { loadGlossary } from '../translate/glossary';
import { loadDictionary } from '../translate/dictionary';
import { translateMarkdown, analyzeMarkdown } from '../markdown';
import type { MarkdownAnalysis } from '../markdown';
import { translateJson, analyzeJson } from '../json';
import type { JsonAnalysis } from '../json';
import { HttpTranslator } from '../providers/http';
import { logger } from './logger';
import {
  walkFiles,
  findJsonSource,
  readUtf8,
  writeUtf8,
  exists,
  ensureDir,
  STANDARD_SKIP,
} from './fs-utils';
import { hashContent, loadCache, saveCache } from './cache';
import { buildConfigTemplate, GLOSSARY_YAML, DICTIONARY_TEMPLATE } from './templates';

export interface ActionOptions {
  config?: string;
  cwd?: string;
  changedOnly?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  locales?: string;
  force?: boolean;
  files?: string[];
  includeConfig?: boolean;
}

/** Optional test seam: supply a translator factory to avoid real network calls. */
export interface ActionDeps {
  createTranslator?: (config: Config) => Translator;
}

function loadConfigSafe(configPath: string | undefined, cwd?: string): Config | null {
  try {
    // Resolve the config relative to the action's working directory (--cwd),
    // not the process cwd, so `--cwd other/dir` picks up that dir's config.
    const base = cwd ?? process.cwd();
    const p = configPath ? resolve(base, configPath) : resolve(base, 'astro-md-translate.config.json');
    return loadConfig(p);
  } catch (err) {
    logger.error(`Config error: ${(err as Error).message}`);
    return null;
  }
}

function mdLine(rel: string, output: string, a: MarkdownAnalysis, skipped: boolean): string {
  return (
    `${rel}  →  ${output}  segments=${a.segments}  code=${a.codeBlocks}  inline=${a.inlineCode}  ` +
    `url=${a.linkUrls}  placeholder=${a.placeholderHits}  glossary=${a.glossaryHits}` +
    (skipped ? '  [skipped: unchanged]' : '')
  );
}

function jsonLine(rel: string, a: JsonAnalysis, skipped: boolean): string {
  return (
    `${rel}  segments=${a.segments}  code=0  inline=0  url=0  ` +
    `placeholder=${a.placeholderHits}  glossary=${a.glossaryHits}` +
    (skipped ? '  [skipped: unchanged]' : '')
  );
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
export async function initAction(options: ActionOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolve(cwd, 'astro-md-translate.config.json');
  const glossaryPath = resolve(cwd, 'glossary.yaml');
  const dictionaryPath = resolve(cwd, 'dictionary.json');
  const targets = [configPath, glossaryPath, dictionaryPath];

  if (!options.force) {
    const existing = targets.filter((p) => exists(p));
    if (existing.length > 0) {
      for (const p of existing) logger.error(`${p} already exists (use --force to overwrite)`);
      return 1;
    }
  }

  writeUtf8(configPath, JSON.stringify(buildConfigTemplate(), null, 2));
  writeUtf8(glossaryPath, GLOSSARY_YAML);
  writeUtf8(dictionaryPath, JSON.stringify(DICTIONARY_TEMPLATE, null, 2));

  const config = loadConfigSafe(configPath);
  if (!config) return 1;
  logger.info(`Generated: ${basename(configPath)}, ${basename(glossaryPath)}, ${basename(dictionaryPath)}`);
  logger.info(`Config loaded OK (targetLocales: ${config.targetLocales.join(', ')}).`);
  logger.info('Next: edit astro-md-translate.config.json (provider fields + targetLocales),');
  logger.info('glossary.yaml (protected brand terms) and dictionary.json (common words).');
  logger.info(
    'Output model: Markdown translations go to <cwd>/<locale>/<relative path>; JSON ' +
      'translations go to <locale>.json next to the source. Source files are never modified.',
  );
  logger.info('Tip: preview what would be translated with: astro-md-translate translate-md --dry-run');
  return 0;
}

// ---------------------------------------------------------------------------
// translate-md
// ---------------------------------------------------------------------------
async function dryRunMarkdown(options: ActionOptions): Promise<number> {
  const config = loadConfigSafe(options.config, options.cwd);
  if (!config) return 1;
  const glossary = loadGlossary(config.glossary);
  const cwd = options.cwd ?? process.cwd();
  const locales = config.targetLocales;
  const skipDirs = new Set<string>([...STANDARD_SKIP, config.sourceLang, ...locales]);
  const files = options.files?.length
    ? options.files.map((f) => resolve(cwd, f))
    : walkFiles(cwd, ['.md', '.mdx'], skipDirs);
  const cache = options.changedOnly ? loadCache(cwd) : {};
  const firstRun = options.changedOnly && Object.keys(cache).length === 0;

  let total = 0;
  let will = 0;
  let skipped = 0;
  let code = 0;
  let inline = 0;
  let url = 0;
  let ph = 0;
  let gl = 0;

  for (const file of files) {
  const rel = relative(cwd, file);
  let content: string;
  try {
    content = readUtf8(file);
  } catch {
    logger.error(`${rel}: read failed`);
    return 2;
  }
  let a: MarkdownAnalysis;
  try {
    a = analyzeMarkdown(content, { config, glossary });
  } catch (err) {
    logger.error(`${rel}: analysis failed: ${(err as Error).message}`);
    return 2;
  }
  const isSkipped = Boolean(
    options.changedOnly &&
      cache[rel] === hashContent(content) &&
      locales.every((L) => exists(join(cwd, L, rel))),
  );
  const outExample = locales.length ? `${locales[0]}/${rel}` : rel;
  const outDisplay = locales.length > 1 ? `${outExample} (×${locales.length})` : outExample;

    logger.info(mdLine(rel, outDisplay, a, isSkipped));
    if (options.verbose) {
      a.segmentProtections.forEach((p, i) => {
        if (p.placeholder || p.glossary) {
          const tags = `${p.placeholder ? ' placeholder' : ''}${p.glossary ? ' glossary' : ''}`;
          logger.info(`  [seg ${i}]${tags}`);
        }
      });
    }
    total++;
    if (isSkipped) skipped++;
    else will++;
    code += a.codeBlocks;
    inline += a.inlineCode;
    url += a.linkUrls;
    ph += a.placeholderHits;
    gl += a.glossaryHits;
  }

  if (firstRun && total > 0) logger.info('No cache baseline; all files will be processed.');
  logger.info(
    `Summary: files=${total} willTranslate=${will} skipped=${skipped} ` +
      `code=${code} inline=${inline} url=${url} placeholder=${ph} glossary=${gl} locales=${locales.length}`,
  );
  return 0;
}

async function translateMarkdownReal(options: ActionOptions, deps?: ActionDeps): Promise<number> {
  const config = loadConfigSafe(options.config, options.cwd);
  if (!config) return 1;
  const glossary = loadGlossary(config.glossary);
  const dictionary = loadDictionary(config.dictionary);
  const cwd = options.cwd ?? process.cwd();
  const sourceLang = config.sourceLang;
  const locales = config.targetLocales;
  const skipDirs = new Set<string>([...STANDARD_SKIP, sourceLang, ...locales]);
  const files = options.files?.length
    ? options.files.map((f) => resolve(cwd, f))
    : walkFiles(cwd, ['.md', '.mdx'], skipDirs);
  const translator = deps?.createTranslator
    ? deps.createTranslator(config)
    : new HttpTranslator({ apiUrl: config.apiUrl, apiKey: config.apiKey, model: config.model });
  const cache = options.changedOnly ? loadCache(cwd) : {};

  let errors = 0;
  let will = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = relative(cwd, file);
    const content = readUtf8(file);
    for (const L of locales) {
      const outPath = join(cwd, L, rel);
      if (options.changedOnly && cache[rel] === hashContent(content) && exists(outPath)) {
        skipped++;
        continue;
      }
      const res = await translateMarkdown(content, {
        config,
        translator,
        targetLang: L,
        sourceLang,
        glossary,
        dictionary,
      });
      const errs = res.issues.filter((i) => i.level === 'error');
      if (errs.length > 0) {
        logger.error(`${rel} -> ${L}: ${errs[0].message}`);
        errors++;
        continue;
      }
      for (const w of res.issues.filter((i) => i.level === 'warn')) {
        logger.warn(`${rel} -> ${L}: ${w.message}`);
      }
      ensureDir(dirname(outPath));
      writeUtf8(outPath, res.content);
      will++;
    }
    cache[rel] = hashContent(content);
  }

  if (options.changedOnly) saveCache(cwd, cache);
  logger.info(
    `Summary: translated=${will} skipped=${skipped} errors=${errors} locales=${locales.length}`,
  );
  return errors > 0 ? 2 : 0;
}

// ---------------------------------------------------------------------------
// translate-json
// ---------------------------------------------------------------------------
function resolveJsonLocales(config: Config, options: ActionOptions): string[] | null {
  const locales = options.locales
    ? options.locales.split(',').map((s) => s.trim()).filter(Boolean)
    : config.targetLocales;
  const invalid = locales.filter((l) => !config.targetLocales.includes(l));
  if (invalid.length > 0) {
    logger.error(`Invalid locales: ${invalid.join(', ')}. Available: ${config.targetLocales.join(', ')}`);
    return null;
  }
  return locales;
}

async function dryRunJson(options: ActionOptions): Promise<number> {
  const config = loadConfigSafe(options.config, options.cwd);
  if (!config) return 1;
  const glossary = loadGlossary(config.glossary);
  const cwd = options.cwd ?? process.cwd();
  const source = findJsonSource(cwd, config.sourceLang, new Set(STANDARD_SKIP));
  if (!source) {
    logger.error(`Source file ${config.sourceLang}.json not found under ${cwd}`);
    return 1;
  }
  const locales = resolveJsonLocales(config, options);
  if (!locales) return 1;
  const rel = relative(cwd, source);
  const content = readUtf8(source);
  const a = analyzeJson(content, { config, glossary });
  const cache = options.changedOnly ? loadCache(cwd) : {};
  const isSkipped = Boolean(
    options.changedOnly &&
      cache[rel] === hashContent(content) &&
      locales.every((L) => exists(join(dirname(source), `${L}.json`))),
  );

  if (!a.valid) {
    logger.error(`${rel}: invalid JSON`);
    return 2;
  }
  logger.info(jsonLine(rel, a, isSkipped));
  if (a.icu) {
    logger.warn(`${rel}: ICU plural/select skeleton detected; 0.1.0 does not protect ICU skeletons`);
  }
  logger.info(
    `Summary: files=1 willTranslate=${isSkipped ? 0 : 1} skipped=${isSkipped ? 1 : 0} ` +
      `placeholder=${a.placeholderHits} glossary=${a.glossaryHits} locales=${locales.length}`,
  );
  return 0;
}

async function translateJsonReal(options: ActionOptions, deps?: ActionDeps): Promise<number> {
  const config = loadConfigSafe(options.config, options.cwd);
  if (!config) return 1;
  const glossary = loadGlossary(config.glossary);
  const dictionary = loadDictionary(config.dictionary);
  const cwd = options.cwd ?? process.cwd();
  const source = findJsonSource(cwd, config.sourceLang, new Set(STANDARD_SKIP));
  if (!source) {
    logger.error(`Source file ${config.sourceLang}.json not found under ${cwd}`);
    return 1;
  }
  const locales = resolveJsonLocales(config, options);
  if (!locales) return 1;
  const translator = deps?.createTranslator
    ? deps.createTranslator(config)
    : new HttpTranslator({ apiUrl: config.apiUrl, apiKey: config.apiKey, model: config.model });
  const rel = relative(cwd, source);
  const content = readUtf8(source);
  const cache = options.changedOnly ? loadCache(cwd) : {};

  let errors = 0;
  let will = 0;
  let skipped = 0;

  for (const L of locales) {
    const outPath = join(dirname(source), `${L}.json`);
    if (options.changedOnly && cache[rel] === hashContent(content) && exists(outPath)) {
      skipped++;
      continue;
    }
    const res = await translateJson(content, {
      config,
      translator,
      targetLang: L,
      sourceLang: config.sourceLang,
      glossary,
      dictionary,
    });
    const errs = res.issues.filter((i) => i.level === 'error');
    if (errs.length > 0) {
      logger.error(`${rel} -> ${L}: ${errs[0].message}`);
      errors++;
      continue;
    }
    for (const w of res.issues.filter((i) => i.level === 'warn')) {
      logger.warn(`${rel} -> ${L}: ${w.message}`);
    }
    writeUtf8(outPath, res.content);
    will++;
  }
  cache[rel] = hashContent(content);
  if (options.changedOnly) saveCache(cwd, cache);
  logger.info(
    `Summary: translated=${will} skipped=${skipped} errors=${errors} locales=${locales.length}`,
  );
  return errors > 0 ? 2 : 0;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------
export async function checkAction(options: ActionOptions): Promise<number> {
  const config = loadConfigSafe(options.config, options.cwd);
  if (!config) return 1;
  const glossary = loadGlossary(config.glossary);
  const cwd = options.cwd ?? process.cwd();
  const skipMd = new Set<string>([...STANDARD_SKIP, config.sourceLang, ...config.targetLocales]);
  const mdFiles = walkFiles(cwd, ['.md', '.mdx'], skipMd);
  const jsonFilesAll = walkFiles(cwd, ['.json'], new Set(STANDARD_SKIP));

  // Default: exclude files referenced by config (config/glossary/dictionary) plus
  // common project manifests. Use --include-config to validate them too.
  const jsonExclude = new Set<string>();
  const basenameExcludes = new Set(['package.json', 'tsconfig.json']);
  if (!options.includeConfig) {
    if (config.glossary) jsonExclude.add(resolve(cwd, config.glossary));
    if (config.dictionary) jsonExclude.add(resolve(cwd, config.dictionary));
    jsonExclude.add(resolve(cwd, options.config ?? 'astro-md-translate.config.json'));
  }
  const jsonFiles = options.includeConfig
    ? jsonFilesAll
    : jsonFilesAll.filter((f) => {
        const b = basename(f);
        if (jsonExclude.has(f)) return false;
        if (basenameExcludes.has(b)) return false;
        if (b.startsWith('glossary.')) return false;
        return true;
      });
  const excludedJsonCount = jsonFilesAll.length - jsonFiles.length;

  let errors = 0;
  let warns = 0;
  let infos = 0;

  for (const file of mdFiles) {
    const rel = relative(cwd, file);
    let a: MarkdownAnalysis;
    try {
      a = analyzeMarkdown(readUtf8(file), { config, glossary });
    } catch (err) {
      logger.error(`${rel}: analysis failed: ${(err as Error).message}`);
      errors++;
      continue;
    }
    if (!a.balancedFences) {
      logger.error(`${rel}: unbalanced fenced code blocks`);
      errors++;
      continue;
    }
    logger.info(
      `${rel}: segments=${a.segments} code=${a.codeBlocks} inline=${a.inlineCode} ` +
        `url=${a.linkUrls} placeholder=${a.placeholderHits} glossary=${a.glossaryHits}`,
    );
    infos++;
    if (a.glossaryHits > 0) {
      logger.info(`${rel}: glossary terms detected: ${a.glossaryHits}`);
      infos++;
    }
  }

  for (const file of jsonFiles) {
    const rel = relative(cwd, file);
    let a: JsonAnalysis;
    try {
      a = analyzeJson(readUtf8(file), { config, glossary });
    } catch (err) {
      logger.error(`${rel}: analysis failed: ${(err as Error).message}`);
      errors++;
      continue;
    }
    if (!a.valid) {
      logger.error(`${rel}: invalid JSON`);
      errors++;
      continue;
    }
    logger.info(
      `${rel}: segments=${a.segments} placeholder=${a.placeholderHits} glossary=${a.glossaryHits}`,
    );
    infos++;
    if (a.icu) {
      logger.warn(
        `${rel}: ICU plural/select skeleton detected; 0.1.0 does not protect ICU skeletons — ` +
          `recommend manual review or add the key to a skip list`,
      );
      warns++;
    }
  }

  if (!options.includeConfig && excludedJsonCount > 0) {
    logger.info(`Excluded ${excludedJsonCount} config/glossary/dictionary files`);
  }
  logger.info(`Summary: error=${errors} warn=${warns} info=${infos}`);
  return errors > 0 ? 2 : 0;
}

// ---------------------------------------------------------------------------
// dispatchers
// ---------------------------------------------------------------------------
export async function translateMdAction(options: ActionOptions, deps?: ActionDeps): Promise<number> {
  return options.dryRun ? dryRunMarkdown(options) : translateMarkdownReal(options, deps);
}

export async function translateJsonAction(options: ActionOptions, deps?: ActionDeps): Promise<number> {
  return options.dryRun ? dryRunJson(options) : translateJsonReal(options, deps);
}
