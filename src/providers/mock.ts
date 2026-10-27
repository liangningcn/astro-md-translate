import type { Translator, TranslateOptions } from './index';

export interface MockTranslatorOptions {
  /**
   * Custom transform applied to each text. Defaults to identity (no change),
   * which is useful when only protection/round-trip behaviour is under test.
   */
  transform?: (text: string, targetLang: string) => string;
}

/**
 * Deterministic translator for tests and dry-runs. It never contacts a network
 * and never throws, so it is safe to use as a stand-in for the real provider.
 */
export class MockTranslator implements Translator {
  readonly name = 'mock';
  private readonly transform: (text: string, lang: string) => string;

  constructor(options: MockTranslatorOptions = {}) {
    this.transform = options.transform ?? ((text) => text);
  }

  async translate(texts: string[], options: TranslateOptions): Promise<string[]> {
    return texts.map((text) => this.transform(text, options.targetLang));
  }
}
