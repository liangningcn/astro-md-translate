# Glossary reference

The glossary protects brand and proper-noun terms during translation. It is a YAML (or JSON) file, by default `glossary.yaml`:

```yaml
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
```

## Entry semantics

| Field | Meaning |
| --- | --- |
| `term` | Source-language text to match (required). |
| `protected` | When not `false`, the term is **masked** before translation and **restored** afterwards. Defaults to `true` when omitted. |
| `replacement` | Text restored in place of the term. Defaults to the original `term`. This is how a trademark form (`ExampleBrand` → `ExampleBrand®`) is expressed without hardcoding brands in code. |
| `preferred` | Optional preferred translation, used as guidance when the term is **not** protected (`protected: false`). |

The three behaviours are independent per entry:

- **protected + replacement** — the model never sees the term; the exact `replacement` is re-inserted after translation.
- **protected only** — same, restored to the original term.
- **preferred only** — the term is translated normally; `preferred` hints the expected translation.

## Matching rules

- Terms match with **word boundaries** (`\b<term>\b`, case-insensitive) and tolerate a trailing `®` (`(?:®)?`), so a `BrandX` entry also catches `BrandX®` already present in the source.
- Because protected terms are masked before the provider call, a translation cannot alter them; if the text after restoration is missing an expected `replacement`, the pipeline records a `glossary.protected-missing` issue (`warn` in Markdown, `warn` in JSON/`translateTexts`).

## Dictionary (short-circuit cache)

`dictionary.json` is a plain `source → { lang → translation }` map:

```json
{
  "Home": { "es": "Inicio", "fr": "Accueil" },
  "Read more": { "es": "Leer más", "fr": "Lire la suite" }
}
```

When a whole text segment matches a dictionary key exactly (or case-insensitively) for the target language, the provider is **not called** for that segment — the local translation is used. This is useful for recurring UI strings and for reducing API quota.
