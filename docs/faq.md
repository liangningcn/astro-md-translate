# FAQ

## How do I fix a bad translation?

Edit the generated file directly — `es/docs/guide.md` or `es.json` are plain files, and the source is never modified, so your edit is safe. Re-running the command with `--changed-only` will not overwrite it (it only re-translates when the **source** hash changes). To force a re-translation of one file, delete the output file (and drop the source's entry from `.astro-md-translate-cache.json`) or run without `--changed-only`.

To prevent the same mistake next time, add the term to `glossary.yaml` (`protected: true` with a `replacement`) or the phrase to `dictionary.json`.

## How do I skip a file or a field?

- **Skip a Markdown file**: it lives in a directory named like a locale? Already excluded. Otherwise move it out of the scan root, or pass explicit files: `translate-md docs/keep-en.md` translates only what you list.
- **Skip a frontmatter field**: add the key to `md.reservedKeys` (or remove it from `md.translatableFields`).
- **Skip a JSON value**: add its key to `json.keyBlacklist` (or `json.skipKeys`). Keys named `id`, `slug`, `url`, `icon` are already excluded by default.
- **Protect a phrase**: `glossary.yaml` (`protected: true`) or `dictionary.json` for a full-segment local translation.

## How do I run a mock smoke test in CI?

`check` is offline by design and fails with exit code `2` on `error`-level issues:

```sh
npx astro-md-translate check
```

For a full-pipeline smoke test without API usage, call the library API with the built-in `MockTranslator` in a unit-test step — the CLI has no offline translate mode in 0.1.0.

## Why did my `{{count}}` turn into `{count}`?

You likely customized `json.placeholderPatterns` and put the single-brace rule (`\{[^}]+\}`) before the double-brace rule. Masking is sequential — restore the generated order (double-brace first). See [configuration.md](configuration.md).

## Why does `check` not report my config file?

`check` excludes files referenced by the config itself (config, glossary, dictionary), plus `package.json`, `tsconfig.json` and `glossary.*`, so you do not get noise about your own settings. Use `check --include-config` to validate them too.

## Why did nothing get translated?

- You ran `--dry-run` (analysis only, no writes).
- `--changed-only` found no changed sources — the tool prints `skipped=N`. Delete `.astro-md-translate-cache.json` for a full pass.
- `translate-json` could not find `<sourceLang>.json` under `--cwd` — it exits `1` and names the missing file.
