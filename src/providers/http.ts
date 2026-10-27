import type { Translator, TranslateOptions } from './index';

/** Language code → English name, used to build the translation prompt. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', th: 'Thai', tr: 'Turkish', pl: 'Polish', nl: 'Dutch',
  vi: 'Vietnamese', id: 'Indonesian',
};

export interface HttpTranslatorOptions {
  /** OpenAI-compatible chat completions URL. */
  apiUrl: string;
  /** Bearer token. */
  apiKey: string;
  /** Model identifier. */
  model: string;
  /** Optional fetch implementation (injectable for tests). */
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * OpenAI-compatible HTTP translator. Reads `apiUrl`/`apiKey`/`model` from config
 * but never hardcodes a real endpoint — defaults are neutral placeholders.
 *
 * Failure semantics: throws on transport/HTTP errors. Callers decide whether to
 * fall back to the original text (fail-safe behaviour lives in the orchestrator).
 */
export class HttpTranslator implements Translator {
  readonly name = 'http';
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpTranslatorOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  async translate(texts: string[], options: TranslateOptions): Promise<string[]> {
    if (texts.length === 0) return [];
    if (texts.every((t) => !t || !t.trim())) return texts;

    const langName = LANGUAGE_NAMES[options.targetLang] ?? options.targetLang;
    const sourceLang = LANGUAGE_NAMES[options.sourceLang ?? 'en'] ?? options.sourceLang ?? 'English';

    const separator = '<<<SEP>>>';
    const combined = texts.map((t, i) => `[${i}] ${t}`).join(`\n${separator}\n`);
    const systemPrompt =
      `You are a professional translator. Translate the following texts from ${sourceLang} to ${langName}.\n` +
      '- Preserve all brand names, product names, and proper nouns exactly as they are.\n' +
      '- Preserve any HTML tags, placeholders, and formatting.\n' +
      '- Keep the same numbering format [index] for each translation.\n' +
      '- Return only the translated texts with their indices, one per line.\n' +
      '- Do not add any extra text, explanations, or comments.\n' +
      '- Maintain the same meaning and tone as the original.';
    const userPrompt = `Translate these texts to ${langName}:\n\n${combined}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let body: unknown;
    try {
      const res = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ] as ChatMessage[],
          temperature: 0.3,
          max_tokens: 4096,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const content = extractContent(body);
    if (content === null) {
      throw new Error('Provider response did not contain message content.');
    }
    return alignTranslations(content, texts.length);
  }
}

function extractContent(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const choices = (body as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  if (!message || typeof message.content !== 'string') return null;
  return message.content;
}

/**
 * Parse a numbered/indexted provider response back into an array aligned to the
 * requested count. Falls back to line order if index markers are missing.
 */
function alignTranslations(content: string, count: number): string[] {
  const lines = content.split('\n').filter((l) => l.trim());
  const byIndex = new Map<number, string>();
  for (const line of lines) {
    const m = line.match(/^\[(\d+)\]\s*(.+)$/) ?? line.match(/^(\d+)\.\s*(.+)$/);
    if (m) byIndex.set(Number(m[1]), m[2].trim());
  }
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(byIndex.get(i) ?? lines[i] ?? '');
  }
  return result;
}
