import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { run } from '../src/cli/index';

describe('smoke', () => {
  it('core entry imports without throwing and exposes VERSION', () => {
    expect(typeof core.VERSION).toBe('string');
    expect(core.VERSION).toBe('0.1.0');
  });

  it('--help output contains all subcommand names', () => {
    const chunks: string[] = [];
    const originalLog = console.log;
    const originalExit = process.exit;

    // cac prints help via console.log and then calls process.exit(0). Capture
    // the output and intercept the exit so the test process survives.
    console.log = ((...args: unknown[]): void => {
      chunks.push(args.map((a) => String(a)).join(' '));
    }) as typeof console.log;
    process.exit = ((): never => {
      throw new Error('__CLI_EXIT__');
    }) as unknown as typeof process.exit;

    try {
      run(['node', 'script', '--help']);
    } catch (err) {
      if ((err as Error).message !== '__CLI_EXIT__') throw err;
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
    }

    const output = chunks.join('\n');
    expect(output).toContain('init');
    expect(output).toContain('translate-md');
    expect(output).toContain('translate-json');
    expect(output).toContain('check');
  });
});
