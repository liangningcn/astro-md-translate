import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig, resolveConfig, ConfigError } from '../../src/config/load';

describe('config layer', () => {
  it('merges a partial raw config over neutral defaults', () => {
    const cfg = resolveConfig({ targetLocales: ['es'], sourceLang: 'en', glossary: 'g.yaml' });
    expect(cfg.targetLocales).toEqual(['es']);
    expect(cfg.sourceLang).toBe('en');
    expect(cfg.glossary).toBe('g.yaml');
    expect(cfg.apiUrl).toBe(DEFAULT_CONFIG.apiUrl);
    expect(cfg.json.skipKeys).toEqual(DEFAULT_CONFIG.json.skipKeys);
    expect(cfg.md.translatableFields).toEqual(DEFAULT_CONFIG.md.translatableFields);
  });

  it('falls back to every default when nothing is provided', () => {
    const cfg = resolveConfig({});
    expect(cfg.targetLocales).toEqual(DEFAULT_CONFIG.targetLocales);
    expect(cfg.sourceLang).toBe('en');
    expect(cfg.concurrency).toBe(4);
    expect(cfg.dictionary).toBe('dictionary.json');
  });

  it('rejects an empty targetLocales with a readable message', () => {
    expect(() => resolveConfig({ targetLocales: [] })).toThrowError(ConfigError);
    expect(() => resolveConfig({ targetLocales: [] })).toThrowError(/targetLocales/);
  });

  it('rejects non-positive concurrency', () => {
    expect(() => resolveConfig({ concurrency: 0 })).toThrowError(/concurrency/);
  });

  it('rejects a non-object config file with a readable error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amd-cfg-'));
    try {
      const p = join(dir, 'bad.json');
      writeFileSync(p, '[1, 2, 3]');
      expect(() => loadConfig(p)).toThrowError(/JSON object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a missing config file as "all defaults"', () => {
    const cfg = loadConfig(join(tmpdir(), 'amd-missing-nope', 'does-not-exist.json'));
    expect(cfg.targetLocales).toEqual(DEFAULT_CONFIG.targetLocales);
  });

  it('regression: default placeholderPatterns keep the double-brace rule first', () => {
    const patterns = DEFAULT_CONFIG.json.placeholderPatterns;
    expect(patterns[0]).toBe('\\{\\{[^}]+\\}\\}');
    expect(patterns[1]).toBe('\\{[^}]+\\}');
  });
});
