# Configuration reference

`astro-md-translate` reads `astro-md-translate.config.json` from the working directory (or the path given via `--config`, resolved relative to `--cwd`). Every field is optional; missing fields fall back to neutral defaults. Generate a full template with `astro-md-translate init`.

## Top-level fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `apiUrl` | string | `https://example.com/v1/chat/completions` | Chat-completions endpoint of an OpenAI-compatible provider. The default is a placeholder — replace it with your provider's URL. |
| `apiKey` | string | `""` | Bearer token sent as `Authorization`. Prefer CI secrets over committing this. |
| `model` | string | `example-model` | Model name passed to the provider. |
| `sourceLang` | string | `en` | Source language code. Also selects the source JSON file (`<sourceLang>.json`) and the Markdown directory excluded from scanning. |
| `targetLocales` | string[] | 16 neutral language codes | Locales to translate into. Must be a non-empty array. `--locales` on `translate-json` must be a subset of this. |
| `glossary` | string | `glossary.yaml` | Path to the glossary file (YAML or JSON). Missing file = empty glossary. |
| `dictionary` | string | `dictionary.json` | Path to the common-word dictionary (JSON). Missing file = empty dictionary. |
| `concurrency` | number | `4` | Reserved for concurrency control. |

## `md` section (Markdown pipeline)

### `md.translatableFields`

Frontmatter keys whose string values (including arrays and nested objects) are translated. Defaults cover common UI/content field names such as `title`, `description`, `summary`, `items`, `faqs`. A key not listed here is left untouched unless it is an object/array, in which case the nested keys are inspected.

### `md.reservedKeys`

Frontmatter keys that are never translated, e.g. `slug`, `date`, `author`, `image`, `layout`, `permalink`. Reserved keys win over `translatableFields`.

### `md.htmlTagPatterns`

Inline HTML that is masked before translation and restored afterwards:

```json
{ "pattern": "<br\\s*/?>", "placeholder": "ZBRZ", "restore": "<br/>" }
```

`pattern` is a regex applied case-insensitively; `restore` is the exact text re-inserted after translation.

## `json` section

### `json.skipKeys` and `json.keyBlacklist`

Both lists exclude values from translation by **key name** (matching the immediate parent key of the value). The blacklist (`id`, `slug`, `url`, `icon`, `image`, `logo`, …) is the strict "never translate" set; `skipKeys` covers structural fields like `src`, `href`, `alt`. The two lists are merged at runtime.

### `json.placeholderPatterns` — matching order semantics

An ordered list of regex sources for interpolation placeholders:

```json
[
  "\\{\\{[^}]+\\}\\}",
  "\\{[^}]+\\}",
  "%s",
  "\\$\\{[^}]+\\}"
]
```

- **Masking is sequential.** Rules are applied in array order; each match is replaced by a placeholder and restored verbatim after translation. Order matters: the double-brace rule must come **before** the single-brace rule, otherwise `\{[^}]+\}` would truncate `{{count}}` to `{{count}` and leave a stray `}`. Keep the generated order when you customize.
- **Statistics are non-overlapping.** The `--dry-run` / `check` placeholder counter combines the patterns into one alternation (in the same order), so `{{count}}` counts once, not twice.
- ICU skeletons (`{count, plural, …}`) are **not** protected in 0.1.0 and will partially match the single-brace rule — `check` warns on them; see Known limitations in the README.

## Where files are looked up

- Markdown sources: every `*.md` / `*.mdx` under `--cwd`, excluding `node_modules`, `dist`, `.git`, build directories, and any directory named like the source or a target locale.
- JSON source: the first `<sourceLang>.json` found under `--cwd` (skipping those directories); output is `<locale>.json` in the same directory.

See [glossary.md](glossary.md) for term semantics and [ci.md](ci.md) for running this in automation.
