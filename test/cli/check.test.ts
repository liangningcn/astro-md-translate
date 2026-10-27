import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkAction } from '../../src/cli/actions';
import { capture, makeTempDir, cleanup, writeFile, writeMiniConfig } from '../helpers';

const icuData = readFileSync(
  fileURLToPath(new URL('../fixtures/data-icu.json', import.meta.url)),
  'utf-8',
);

describe('check command', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => {
    cleanup(dir);
  });

  it('excludes config/glossary/dictionary/manifests by default and reports the count', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'dictionary.json', '{}');
    writeFile(dir, 'package.json', '{}');
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));
    writeFile(dir, 'bad.json', '{ not json');
    writeFile(dir, 'page.md', '# Hi\n\nText.\n');

    const cap = capture();
    const code = await checkAction({ cwd: dir });
    cap.restore();

    expect(code).toBe(2);
    expect(cap.out).toContain('Excluded 3 config/glossary/dictionary files');
    expect(cap.out).not.toContain('astro-md-translate.config.json: segments=');
    expect(cap.out).not.toContain('dictionary.json: segments=');
    expect(cap.out).not.toContain('package.json: segments=');
    expect(cap.out).toContain('en.json: segments=');
    expect(cap.err).toContain('bad.json: invalid JSON');
    expect(cap.out).toContain('Summary: error=1');
  });

  it('validates those files too when --include-config is set', async () => {
    writeMiniConfig(dir, ['es']);
    writeFile(dir, 'dictionary.json', '{}');
    writeFile(dir, 'bad.json', '{ not json');

    const cap = capture();
    const code = await checkAction({ cwd: dir, includeConfig: true });
    cap.restore();

    expect(code).toBe(2);
    expect(cap.out).not.toContain('Excluded');
    expect(cap.out).toContain('astro-md-translate.config.json: segments=');
    expect(cap.out).toContain('dictionary.json: segments=');
  });

  it('warns on ICU skeletons without failing (exit code 0)', async () => {
    writeFile(dir, 'en.json', icuData);
    writeFile(dir, 'page.md', '# Hi\n\nText.\n');

    const cap = capture();
    const code = await checkAction({ cwd: dir });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.err).toContain('ICU plural/select skeleton detected');
    expect(cap.out).toContain('Summary: error=0 warn=1');
    expect(cap.out).not.toContain('Excluded');
  });

  it('returns 0 for a clean directory', async () => {
    writeFile(dir, 'page.md', '# Hi\n\nText.\n');
    writeFile(dir, 'en.json', JSON.stringify({ hello: 'Hello' }));

    const cap = capture();
    const code = await checkAction({ cwd: dir });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.out).toContain('Summary: error=0 warn=0');
    expect(cap.out).not.toContain('Excluded');
  });
});
