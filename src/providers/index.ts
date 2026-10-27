/**
 * Translator provider interface.
 *
 * A `Translator` turns a batch of source-language texts into target-language
 * texts. Implementations may call an external API, cache results, or (for
 * tests) return deterministic output. The orchestrator aligns the returned
 * array 1:1 with the input array.
 */

export interface TranslateOptions {
  /** Target language code, e.g. `es`. */
  targetLang: string;
  /** Source language code (defaults to `en`). */
  sourceLang?: string;
}

export interface Translator {
  readonly name: string;
  /** Translate `texts` in a single batch. Never throws for individual failures
   *  in well-behaved implementations; alignment with `texts` is required. */
  translate(texts: string[], options: TranslateOptions): Promise<string[]>;
}
