import { DEFAULT_CONFIG } from '../config/load';
import type { Config } from '../config/types';

/** A directly-consumable config: the neutral defaults with glossary/dictionary paths. */
export function buildConfigTemplate(): Config {
  return {
    ...DEFAULT_CONFIG,
    glossary: 'glossary.yaml',
    dictionary: 'dictionary.json',
  };
}

/** Neutral glossary example (YAML). Edit to protect brand/proper nouns. */
export const GLOSSARY_YAML = `# Translation glossary (neutral example). Edit to protect brand/proper nouns.
# protected: true masks the term during translation and restores 'replacement'.
entries:
  - term: ExampleBrand
    replacement: ExampleBrand®
    protected: true
  - term: AnotherMark
    replacement: AnotherMark®
    protected: true
  - term: SampleTerm
    preferred: SampleTermTranslation
    protected: false
`;

/** Neutral common-word dictionary example. */
export const DICTIONARY_TEMPLATE = {
  Home: { es: 'Inicio', fr: 'Accueil' },
  'Read more': { es: 'Leer más', fr: 'Lire la suite' },
};
