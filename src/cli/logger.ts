/** Minimal leveled logger. `info` → stdout; `warn`/`error` → stderr. */
export const logger = {
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`warn: ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`error: ${message}\n`);
  },
};
