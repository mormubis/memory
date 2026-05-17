# Changelog

## [0.1.1] - 2026-05-17

### Changed

- Aligned ESLint config with echecs conventions (unicorn, import-x, vitest
  plugins).
- Replaced `null` with `undefined` across the public API (`Memory.parentId`,
  `RememberResult.parentId`, `ResolvedConfig.embed`).
- Renamed `db.ts` to `database.ts`.
- Updated `tsdown` to v0.22, output now uses `.mjs`/`.d.mts` extensions.

### Added

- Husky pre-commit hooks with lint-staged (prettier + eslint on staged files).
- Pure relevance scoring in search (strength controls eviction only, not
  ranking).
- Weight normalization when a search stream returns no results.
- Lineage diversification in search (max 3 results per version chain).

## [0.1.0] - 2026-05-17

- initial release
- unified memory store with SQLite (FTS5 + better-sqlite3)
- content-similarity-based versioning with auto-boost
- typed directional links with weight decay
- hybrid search: BM25 + vector similarity + RRF fusion + link expansion
- lazy Ebbinghaus decay with configurable rate and eviction threshold
- type-based default strength via `typeStrength` config map
- injectable clock for testing
- optional `@huggingface/transformers` for default local embeddings
