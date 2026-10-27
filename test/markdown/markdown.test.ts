import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/load';
import { translateMarkdown, analyzeMarkdown } from '../../src/markdown';
import { MockTranslator } from '../../src/providers/mock';
import type { Translator } from '../../src/providers/index';
import type { Glossary } from '../../src/translate/glossary';

/** Translator that counts provider calls, for short-circuit assertions. */
class CountingTranslator implements Translator {
  readonly name = 'counting';
  calls = 0;
  constructor(private readonly transform: (text: string) => string = (t) => t) {}
  async translate(texts: string[]): Promise<string[]> {
    this.calls++;
    return texts.map(this.transform);
  }
}

const config = loadConfig();
const samplePath = fileURLToPath(new URL('../fixtures/sample.md', import.meta.url));
const sample = readFileSync(samplePath, 'utf-8');

describe('markdown pipeline: translateMarkdown', () => {
  it('keeps code blocks, inline code, link URLs, images, HTML and alerts intact', async () => {
    const { content, issues } = await translateMarkdown(sample, {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
      sourceLang: 'en',
    });
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(content).toContain('const answer = 42;');
    expect(content).toContain('npm install');
    expect(content).toContain('https://example.com/guide');
    expect(content).toContain('/images/logo.png');
    expect(content).toContain('<a href="https://example.com/contact">');
    expect(content).toContain('[!NOTE]');
    expect(content).toContain('{name}');
    expect(content).toContain('{{count}}');
    expect(content).toContain('slug: keep-me-slug');
    expect(content).toContain('title: Welcome to the docs');
  });

  it('protects body placeholders (candidate 1) while translating surrounding text', async () => {
    const translator = new MockTranslator({ transform: (x) => `${x}-T` });
    const { content } = await translateMarkdown('Use {name} and {{count}} here.', {
      config,
      translator,
      targetLang: 'es',
    });
    expect(content).toContain('{name}');
    expect(content).toContain('{{count}}');
    expect(content).toContain('-T');
  });

  it('translates frontmatter fields but keeps reserved keys', async () => {
    const translator = new MockTranslator({ transform: (x) => `${x}-T` });
    const md = '---\ntitle: Hello\nslug: keep-slug\n---\n\nBody text.\n';
    const { content } = await translateMarkdown(md, { config, translator, targetLang: 'es' });
    expect(content).toContain('title: Hello-T');
    expect(content).toContain('slug: keep-slug');
  });

  it('accepts resolvable anchors and warns (not errors) on broken ones', async () => {
    const md = '# Hello\n\nSee [back](#hello).\n';
    const ok = await translateMarkdown(md, {
      config,
      translator: new MockTranslator(),
      targetLang: 'es',
    });
    expect(ok.issues.some((i) => i.rule === 'md.anchor-broken')).toBe(false);

    const shifting = new MockTranslator({ transform: (x) => `${x}-ES` });
    const broken = await translateMarkdown(md, { config, translator: shifting, targetLang: 'es' });
    const warn = broken.issues.find((i) => i.rule === 'md.anchor-broken');
    expect(warn).toBeDefined();
    expect(warn?.level).toBe('warn');
  });

  it('records an error-level issue and keeps the original when the provider fails', async () => {
    class ThrowingTranslator {
      readonly name = 'throwing';
      async translate(): Promise<string[]> {
        throw new Error('provider down');
      }
    }
    const src = '# Title\n\nSome text.\n';
    const { issues } = await translateMarkdown(src, {
      config,
      translator: new ThrowingTranslator() as never,
      targetLang: 'es',
    });
    expect(issues.some((i) => i.level === 'error' && i.rule === 'translate.provider-error')).toBe(true);
  });
});

describe('markdown pipeline: analyzeMarkdown', () => {
  it('counts segments and protection hits for the sample fixture', () => {
    const a = analyzeMarkdown(sample, { config });
    // 2 frontmatter fields (title/description; slug reserved) + 10 body text
    // nodes + 1 image alt. Note: `[!NOTE]` is plain text here (no GFM-alert
    // plugin). The image path is a protected target, not a segment.
    expect(a.segments).toBe(13);
    expect(a.codeBlocks).toBe(1);
    expect(a.inlineCode).toBe(1);
    expect(a.linkUrls).toBe(1);
    expect(a.placeholderHits).toBe(2);
    expect(a.glossaryHits).toBe(0);
    expect(a.balancedFences).toBe(true);
  });

  it('detects unbalanced code fences', () => {
    const a = analyzeMarkdown('# Title\n\n```js\nconst x = 1;\n', { config });
    expect(a.balancedFences).toBe(false);
  });

  it('counts glossary term hits when a glossary is provided', () => {
    const a = analyzeMarkdown('BrandX is great.', {
      config,
      glossary: { entries: [{ term: 'BrandX' }] },
    });
    expect(a.glossaryHits).toBe(1);
  });

  it('counts image alt as a segment but keeps the path as a protected target', () => {
    const a = analyzeMarkdown('![Logo](/images/logo.png)\n', { config });
    expect(a.segments).toBe(1);
    expect(a.linkUrls).toBe(0);
  });
});

describe('markdown pipeline: image alt translation', () => {
  const shifting = new CountingTranslator((t) => `${t}-T`);

  it('translates the alt of ![alt](/path) and leaves the path untouched', async () => {
    const { content } = await translateMarkdown('![Logo](/images/logo.png)\n', {
      config,
      translator: shifting,
      targetLang: 'es',
    });
    expect(content).toContain('![Logo-T](/images/logo.png)');
    expect(content).toContain('/images/logo.png');
    expect(content).not.toContain('images/logo.png-T');
  });

  it('translates the alt of ![alt][ref] and leaves the reference identifier and definition untouched', async () => {
    const md = '![Logo][ref]\n\n[ref]: /images/logo.png\n';
    const { content } = await translateMarkdown(md, {
      config,
      translator: new CountingTranslator((t) => `${t}-T`),
      targetLang: 'es',
    });
    expect(content).toContain('![Logo-T][ref]');
    expect(content).toContain('[ref]: /images/logo.png');
  });

  it('translates only the alt when a title attribute is present', async () => {
    const md = '![Logo](/images/logo.png "A title")\n';
    const { content } = await translateMarkdown(md, {
      config,
      translator: new CountingTranslator((t) => `${t}-T`),
      targetLang: 'es',
    });
    expect(content).toContain('![Logo-T](/images/logo.png "A title")');
  });

  it('keeps a protected glossary alt and never calls the provider', async () => {
    const glossary: Glossary = { entries: [{ term: 'ExampleBrand', protected: true }] };
    const spy = new CountingTranslator((t) => `${t}-T`);
    const { content } = await translateMarkdown('![ExampleBrand](/b.png)\n', {
      config,
      translator: spy,
      targetLang: 'es',
      glossary,
    });
    expect(content).toContain('![ExampleBrand](/b.png)');
    expect(content).not.toContain('ExampleBrand-T');
    expect(spy.calls).toBe(0);
  });

  it('uses the glossary replacement for a protected alt without calling the provider', async () => {
    const glossary: Glossary = {
      entries: [{ term: 'ExampleBrand', replacement: 'ExampleBrand®', protected: true }],
    };
    const spy = new CountingTranslator((t) => `${t}-T`);
    const { content } = await translateMarkdown('![ExampleBrand](/b.png)\n', {
      config,
      translator: spy,
      targetLang: 'es',
      glossary,
    });
    expect(content).toContain('![ExampleBrand®](/b.png)');
    expect(spy.calls).toBe(0);
  });

  it('regression: body text and placeholder masking are unaffected by alt translation', async () => {
    const md = 'Use {name} and {{count}} here.\n\n![Logo](/logo.png)\n';
    const { content } = await translateMarkdown(md, {
      config,
      translator: new CountingTranslator((t) => `${t}-T`),
      targetLang: 'es',
    });
    expect(content).toContain('{name}');
    expect(content).toContain('{{count}}');
    expect(content).toContain('![Logo-T](/logo.png)');
  });

  describe('rejects invalid alt translations and keeps the original (warn)', () => {
    const cases: Array<[string, (t: string) => string]> = [
      ['empty', () => ''],
      ['unrestored mask', () => 'x P0 '],
      ['url injected', () => 'see https://evil.example.com'],
    ];

    for (const [name, transform] of cases) {
      it(`rejects an ${name} alt`, async () => {
        const { content, issues } = await translateMarkdown('![Logo](/images/logo.png)\n', {
          config,
          translator: new CountingTranslator(transform),
          targetLang: 'es',
        });
        const warn = issues.find((i) => i.rule === 'md.image-alt-invalid');
        expect(warn).toBeDefined();
        expect(warn?.level).toBe('warn');
        expect(content).toContain('![Logo](/images/logo.png)');
      });
    }
  });
});
