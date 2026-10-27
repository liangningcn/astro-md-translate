# Running in CI (GitHub Actions)

The README shows a complete PR-mode workflow. This page explains the decisions behind it.

## Why PR mode

Translation output is generated content with model judgement in it. Opening a pull request means:

- A human reviews the diff before it lands on `main`.
- A bad batch can be reverted with a single PR close.
- CI checks (build, link check, your own tests) run on the translation branch exactly as they would on any other change.

Direct pushes to `main` from automation are deliberately avoided in 0.1.0.

## Secrets

The example workflow reads the provider key from a repository secret:

```yaml
env:
  API_KEY: ${{ secrets.TRANSLATION_API_KEY }}
```

Create it under **Settings → Secrets and variables → Actions → New repository secret**. Never put the key in the config file; `astro-md-translate.config.json` should contain the non-secret fields (`apiUrl`, `model`, `targetLocales`, …). If your config reads the key from the environment, make sure your provider wrapper picks up `API_KEY`; otherwise patch the config in the workflow step before running.

Scope the secret to the environment that runs the job, and rotate it if it ever appears in logs.

## `--changed-only` in CI

`--changed-only` compares a SHA-256 hash of each source file against `.astro-md-translate-cache.json`, which is written **after a successful real run** (not by `--dry-run`).

Consequences in CI:

- **First run on a fresh runner: the cache is not there**, so every file is processed and the tool prints `No cache baseline; all files will be processed.` Commit the cache file if you want incremental behaviour across builds.
- **Subsequent runs** skip sources whose hash matches and whose output already exists — that is what keeps scheduled runs cheap.
- The cache is repo-local state, not a secret; committing it is safe and recommended.

## Mock smoke step

The workflow ends with:

```sh
npx astro-md-translate check
```

`check` never calls the provider — it validates protection integrity, JSON well-formedness and glossary consistency, and exits `2` if it finds `error`-level issues. It is a free regression gate for every batch.

To smoke-test the full translation pipeline without spending quota, point the config at a mock-compatible endpoint or run the library API with `MockTranslator` in your own test step — the CLI itself has no offline translate mode in 0.1.0.
