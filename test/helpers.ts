import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CapturedOutput {
  /** Everything written to stdout (logger.info). */
  readonly out: string;
  /** Everything written to stderr (logger.warn / logger.error). */
  readonly err: string;
  restore: () => void;
}

/** Capture logger output: info → stdout, warn/error → stderr. */
export function capture(): CapturedOutput {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    outChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    errChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    get out(): string {
      return outChunks.join('');
    },
    get err(): string {
      return errChunks.join('');
    },
    restore(): void {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
  };
}

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'amd-test-'));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Write a file inside `dir` (creating parent directories as needed). */
export function writeFile(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

/** Write a minimal config with the given locale set. */
export function writeMiniConfig(dir: string, locales: string[] = ['es', 'fr']): void {
  writeFile(
    dir,
    'astro-md-translate.config.json',
    JSON.stringify({ sourceLang: 'en', targetLocales: locales }, null, 2),
  );
}
