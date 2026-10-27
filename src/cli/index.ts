import { cac } from 'cac';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PKG_NAME } from '../utils/constants';
import { initAction, checkAction, translateMdAction, translateJsonAction } from './actions';
import type { ActionOptions } from './actions';

/**
 * Build the CLI instance with all subcommands wired to their handlers.
 */
export function createCli(): ReturnType<typeof cac> {
  const cli = cac(PKG_NAME);

  cli
    .command('init', 'Generate config, glossary and dictionary templates')
    .option('--force', 'Overwrite existing files')
    .option('--cwd <dir>', 'Working directory')
    .action(async (opts: ActionOptions) => {
      process.exitCode = await initAction(opts);
    });

  cli
    .command('translate-md [files...]', 'Translate Markdown documents')
    .option('--config <path>', 'Path to config file')
    .option('--cwd <dir>', 'Working directory')
    .option('--changed-only', 'Skip files whose source is unchanged')
    .option('--dry-run', 'Analyze only; do not call the API or write files')
    .option('--verbose', 'Show per-segment protection details')
    .action(async (files: string[], opts: ActionOptions) => {
      process.exitCode = await translateMdAction({ ...opts, files: files ?? [] });
    });

  cli
    .command('translate-json [files...]', 'Translate i18n JSON language files')
    .option('--config <path>', 'Path to config file')
    .option('--cwd <dir>', 'Working directory')
    .option('--changed-only', 'Skip locales whose source is unchanged')
    .option('--locales <list>', 'Comma-separated target locales')
    .option('--dry-run', 'Analyze only')
    .option('--verbose', 'Show details')
    .action(async (files: string[], opts: ActionOptions) => {
      process.exitCode = await translateJsonAction({ ...opts, files: files ?? [] });
    });

  cli
    .command('check', 'Validate protection integrity and glossary consistency')
    .option('--config <path>', 'Path to config file')
    .option('--cwd <dir>', 'Working directory')
    .option('--include-config', 'Also validate config/glossary/dictionary files (excluded by default)')
    .option('--verbose', 'Show details')
    .action(async (opts: ActionOptions) => {
      process.exitCode = await checkAction(opts);
    });

  cli.help();
  cli.version('0.1.0');

  return cli;
}

/**
 * Parse argv and run the CLI.
 * @param argv full argv (including node + script); cac slices off the first two
 * entries internally, so pass `process.argv`, not `process.argv.slice(2)`.
 */
export function run(argv: string[] = process.argv): void {
  const cli = createCli();
  cli.parse(argv);
}

// Execute only when invoked directly as the bin (not when imported by a test
// or by another module). Compare normalized real paths so it works regardless
// of forward/back slashes or symlinks.
const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  run();
}
