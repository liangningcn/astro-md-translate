import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/load';
import type { Translator } from '../../src/providers/index';
import { MockTranslator } from '../../src/providers/mock';
import {
  initAction,
  checkAction,
  translateMdAction,
  translateJsonAction,
} from '../../src/cli/actions';
import type { ActionDeps } from '../../src/cli/actions';
import { capture, makeTempDir, cleanup, writeFile, writeMiniConfig } from '../helpers';

class ThrowingTranslator implements Translator {
  readonly name = 'throwing';
  async translate(): Promise<string[]> {
    throw new Error('provider down');
  }
}

const mockDeps: ActionDeps = { createTranslator: () => new MockTranslator() };

describe('cli actions', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => {
    cleanup(dir);
  });

  it('translate-md --dry-run shows source → output per file plus a summary', async () => {
    writeMiniConfig(dir, ['es', 'fr']);
    writeFile(dir, 'sample.md', '# Hi\n\nUse {name} here.\n');

    const cap = capture();
    const code = await translateMdAction({ cwd: dir, dryRun: true });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.out).toContain('sample.md  →  es/sample.md (×2)');
    expect(cap.out).toMatch(/segments=\d+/);
    expect(cap.out).toContain('placeholder=1');
    expect(cap.out).toContain('Summary: files=1 willTranslate=1 skipped=0');
    expect(cap.out).toContain('locales=2');
  });

  it('translate-json --dry-run rejects unknown locales with exit code 1', async () => {
    writeMiniConfig(dir, ['es', 'fr']);
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));

    const cap = capture();
    const code = await translateJsonAction({ cwd: dir, dryRun: true, locales: 'zz' });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.err).toContain('Invalid locales: zz');
    expect(cap.err).toContain('Available: es, fr');
  });

  it('translate-json --dry-run accepts a valid locale subset', async () => {
    writeMiniConfig(dir, ['es', 'fr']);
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));

    const cap = capture();
    const code = await translateJsonAction({ cwd: dir, dryRun: true, locales: 'es' });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.out).toContain('locales=1');
  });

  it('init refuses to overwrite without --force and succeeds with it', async () => {
    const d = makeTempDir();
    try {
      expect(await initAction({ cwd: d })).toBe(0);
      const cap = capture();
      expect(await initAction({ cwd: d })).toBe(1);
      cap.restore();
      expect(cap.err).toContain('already exists');
      expect(await initAction({ cwd: d, force: true })).toBe(0);
    } finally {
      cleanup(d);
    }
  });

  it('init generates a config that loadConfig accepts (phase-3 self-check regression)', async () => {
    const d = makeTempDir();
    try {
      expect(await initAction({ cwd: d })).toBe(0);
      const cfg = loadConfig(join(d, 'astro-md-translate.config.json'));
      expect(cfg.targetLocales.length).toBeGreaterThan(0);
      expect(cfg.glossary).toBe('glossary.yaml');
      expect(cfg.json.placeholderPatterns[0]).toBe('\\{\\{[^}]+\\}\\}');
    } finally {
      cleanup(d);
    }
  });

  it('regression: --changed-only translates fully once, then skips unchanged sources', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'sample.md', 'Hello there.\n');

    expect(await translateMdAction({ cwd: dir, changedOnly: true }, mockDeps)).toBe(0);
    expect(existsSync(join(dir, 'es', 'sample.md'))).toBe(true);
    const sourceBefore = readFileSync(join(dir, 'sample.md'), 'utf-8');

    const cap = capture();
    const second = await translateMdAction({ cwd: dir, changedOnly: true }, mockDeps);
    cap.restore();

    expect(second).toBe(0);
    expect(cap.out).toContain('translated=0');
    expect(cap.out).toContain('skipped=1');
    expect(readFileSync(join(dir, 'sample.md'), 'utf-8')).toBe(sourceBefore);
  });

  it('translate-json --changed-only also skips unchanged sources on the second run', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));

    expect(await translateJsonAction({ cwd: dir, changedOnly: true }, mockDeps)).toBe(0);
    expect(existsSync(join(dir, 'es.json'))).toBe(true);

    const cap = capture();
    expect(await translateJsonAction({ cwd: dir, changedOnly: true }, mockDeps)).toBe(0);
    cap.restore();

    expect(cap.out).toContain('translated=0');
    expect(cap.out).toContain('skipped=1');
  });

  it('keeps the source intact and writes nothing when the provider fails (exit 2)', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'sample.md', 'Hello there.\n');
    const deps: ActionDeps = { createTranslator: () => new ThrowingTranslator() };

    const cap = capture();
    const code = await translateMdAction({ cwd: dir }, deps);
    cap.restore();

    expect(code).toBe(2);
    expect(cap.err).toContain('sample.md -> es');
    expect(existsSync(join(dir, 'es', 'sample.md'))).toBe(false);
    expect(readFileSync(join(dir, 'sample.md'), 'utf-8')).toBe('Hello there.\n');
  });

  it('writes translations to <locale>/<relative path> without touching the source', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'docs/page.md', 'Body text.\n');

    const cap = capture();
    const code = await translateMdAction({ cwd: dir }, mockDeps);
    cap.restore();

    expect(code).toBe(0);
    expect(existsSync(join(dir, 'es', 'docs', 'page.md'))).toBe(true);
    expect(readFileSync(join(dir, 'docs', 'page.md'), 'utf-8')).toBe('Body text.\n');
  });

  it('exit codes: normal dry-run 0, bad parameter 1, check error 2', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));

    expect(await translateJsonAction({ cwd: dir, dryRun: true })).toBe(0);

    expect(await translateJsonAction({ cwd: dir, dryRun: true, locales: 'zz' })).toBe(1);

    writeFile(dir, 'bad.json', '{ not json');
    expect(await checkAction({ cwd: dir })).toBe(2);
  });
});
