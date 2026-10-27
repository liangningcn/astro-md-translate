import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/load';
import { translateJson, analyzeJson } from '../../src/json';
import { MockTranslator } from '../../src/providers/mock';

const config = loadConfig();
const dataPath = fileURLToPath(new URL('../fixtures/data.json', import.meta.url));
const data = readFileSync(dataPath, 'utf-8');
const icuPath = fileURLToPath(new URL('../fixtures/data-icu.json', import.meta.url));
const icuData = readFileSync(icuPath, 'utf-8');
const shifting = new MockTranslator({ transform: (x) => `${x}-T` });

describe('json pipeline: translateJson', () => {
  it('keeps the key set, nesting and array order; keys are never translated', async () => {
    const { content, issues } = await translateJson(data, {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
    });
    const src: Record<string, unknown> = JSON.parse(data);
    const out: Record<string, unknown> = JSON.parse(content);
    expect(Object.keys(out)).toEqual(Object.keys(src));
    expect(Object.keys(out.nested as object)).toEqual(Object.keys(src.nested as object));
    expect((out.nested as { items: string[] }).items).toEqual(['One', 'Two']);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('protects {name}, {{count}}, ${x} and %s placeholders', async () => {
    const { content } = await translateJson(data, {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
    });
    expect(content).toContain('{name}');
    expect(content).toContain('{{count}}');
    expect(content).toContain('${amount}');
    expect(content).toContain('%s');
  });

  it('respects the key blacklist (id/slug/url/icon stay untouched)', async () => {
    const { content } = await translateJson(data, { config, translator: shifting, targetLang: 'es' });
    const out = JSON.parse(content) as Record<string, unknown>;
    expect(out.id).toBe('keep-id');
    expect(out.slug).toBe('keep-slug');
    expect(out.url).toBe('https://example.com/a');
    expect(out.icon).toBe('arrow');
    expect(out.greeting).toContain('-T');
    expect((out.nested as { label: string }).label).toBe('Submit form-T');
  });

  it('keeps empty strings, numbers and symbol-only values as-is', async () => {
    const { content } = await translateJson(data, { config, translator: shifting, targetLang: 'es' });
    const out = JSON.parse(content) as Record<string, unknown>;
    expect(out.empty).toBe('');
    expect(out.number).toBe(42);
    expect(out.symbol).toBe('---');
  });

  it('emits parseable JSON with 2-space indentation', async () => {
    const { content } = await translateJson(data, {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
    });
    expect(() => JSON.parse(content)).not.toThrow();
    expect(content).toContain('\n  "greeting"');
  });

  it('returns an error issue and the original content for invalid JSON input', async () => {
    const { content, issues } = await translateJson('{ not json', {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
    });
    expect(content).toBe('{ not json');
    expect(issues.some((i) => i.level === 'error' && i.rule === 'json.parse')).toBe(true);
  });
});

describe('json pipeline: analyzeJson', () => {
  it('counts translatable segments and protection hits for the fixture', () => {
    const a = analyzeJson(data, { config });
    expect(a.valid).toBe(true);
    expect(a.segments).toBe(8);
    expect(a.placeholderHits).toBe(5);
    expect(a.glossaryHits).toBe(0);
    expect(a.icu).toBe(false);
  });

  it('flags ICU plural skeletons', () => {
    const a = analyzeJson(icuData, { config });
    expect(a.valid).toBe(true);
    expect(a.segments).toBe(1);
    expect(a.icu).toBe(true);
  });

  it('reports invalid JSON as not valid', () => {
    const a = analyzeJson('{ nope', { config });
    expect(a.valid).toBe(false);
    expect(a.segments).toBe(0);
  });

  it('counts glossary term hits when a glossary is provided', () => {
    const a = analyzeJson(data, {
      config,
      glossary: { entries: [{ term: 'Hello' }] },
    });
    expect(a.glossaryHits).toBeGreaterThanOrEqual(1);
  });
});
