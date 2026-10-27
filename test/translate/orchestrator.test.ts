import { describe, expect, it } from 'vitest';
import { translateTexts, MAX_CHUNK_SIZE } from '../../src/translate/orchestrator';
import { Protector, buildPlaceholderProtections } from '../../src/translate/protector';
import { missingProtectedTerms } from '../../src/translate/glossary';
import type { Glossary } from '../../src/translate/glossary';
import { MockTranslator } from '../../src/providers/mock';
import type { Translator, TranslateOptions } from '../../src/providers/index';
import { DEFAULT_CONFIG } from '../../src/config/load';

class SpyTranslator implements Translator {
  readonly name = 'spy';
  calls: string[][] = [];
  constructor(private readonly impl?: (texts: string[]) => string[]) {}
  async translate(texts: string[], _options: TranslateOptions): Promise<string[]> {
    this.calls.push(texts);
    return this.impl ? this.impl(texts) : texts;
  }
}

class ThrowingTranslator implements Translator {
  readonly name = 'throwing';
  async translate(): Promise<string[]> {
    throw new Error('provider down');
  }
}

describe('orchestrator: translateTexts', () => {
  it('masks, translates and restores {name}, {{count}}, ${price} and %s verbatim', async () => {
    const texts = [
      'Hello {name}',
      'You have {{count}} items',
      'Total: ${price}',
      'Saved %s file',
    ];
    const { texts: out, issues } = await translateTexts(texts, {
      targetLang: 'es',
      translator: new MockTranslator(),
    });
    expect(out).toEqual(texts);
    expect(issues).toHaveLength(0);
  });

  it('regression: {{count}} is not truncated by the single-brace rule (phase-3 fix)', async () => {
    const src = 'You have {{count}} items and {name} here';
    const { texts } = await translateTexts([src], {
      targetLang: 'es',
      translator: new MockTranslator(),
    });
    expect(texts[0]).toBe(src);
  });

  it('regression: the Protector masks {{count}} as one whole span with no stray brace', () => {
    const p = new Protector();
    const protections = buildPlaceholderProtections(DEFAULT_CONFIG.json.placeholderPatterns);
    const masked = p.mask('You have {{count}} items', protections);
    expect(masked.map.size).toBe(1);
    expect(masked.text).not.toContain('{{');
    expect(masked.text).not.toContain('}');
    expect(p.restore(masked.text, masked.map)).toBe('You have {{count}} items');
  });

  it('short-circuits dictionary hits without calling the provider', async () => {
    const spy = new SpyTranslator();
    const dictionary = { Hello: { es: 'Hola' } };
    const { texts } = await translateTexts(['Hello', 'World'], {
      targetLang: 'es',
      translator: spy,
      dictionary,
    });
    expect(texts[0]).toBe('Hola');
    expect(texts[1]).toBe('World');
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toEqual(['World']);
  });

  it('splits batches by MAX_CHUNK_SIZE', async () => {
    expect(MAX_CHUNK_SIZE).toBeGreaterThan(0);
    const spy = new SpyTranslator();
    const long = 'a'.repeat(2000);
    await translateTexts([long, long, long], { targetLang: 'es', translator: spy });
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[0]).toHaveLength(2);
    expect(spy.calls[1]).toHaveLength(1);
  });

  it('restores protected glossary terms even when the translator mangles them', async () => {
    const glossary: Glossary = {
      entries: [{ term: 'BrandX' }, { term: 'BrandY', replacement: 'BrandY®' }],
    };
    const mangler = new MockTranslator({
      transform: (t) => t.replace(/BrandX|BrandY/g, 'Mangled'),
    });
    const { texts, issues } = await translateTexts(['BrandX and BrandY are great'], {
      targetLang: 'es',
      translator: mangler,
      glossary,
    });
    expect(texts[0]).toContain('BrandX');
    expect(texts[0]).toContain('BrandY®');
    expect(issues).toHaveLength(0);
  });

  it('reports protected glossary terms missing from a translated text', () => {
    const glossary: Glossary = { entries: [{ term: 'BrandX' }] };
    expect(missingProtectedTerms('BrandX is nice', 'Mangled is nice', glossary)).toEqual(['BrandX']);
    expect(missingProtectedTerms('BrandX is nice', 'BrandX is nice', glossary)).toEqual([]);
    expect(missingProtectedTerms('nothing here', 'nothing here', glossary)).toEqual([]);
  });

  it('keeps every original and records an error when the provider fails', async () => {
    const src = ['one', 'two'];
    const { texts, issues } = await translateTexts(src, {
      targetLang: 'es',
      translator: new ThrowingTranslator(),
    });
    expect(texts).toEqual(src);
    expect(issues.some((i) => i.level === 'error' && i.rule === 'translate.provider-error')).toBe(true);
  });

  it('never sends empty, whitespace-only or symbol-only text to the provider', async () => {
    const spy = new SpyTranslator();
    const { texts } = await translateTexts(['', '   ', '---', 'real text'], {
      targetLang: 'es',
      translator: spy,
    });
    expect(texts).toEqual(['', '   ', '---', 'real text']);
    expect(spy.calls[0]).toEqual(['real text']);
  });
});
