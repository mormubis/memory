# Changelog

## [0.5.0] - 2026-10-26

### Changed

- `remember()` only auto-versions against memories of the same type. Previously,
  new content similar to a memory of another type superseded it, so a `person`
  could become a `fact` and drag its links along. That memory now stays current.
- `better-sqlite3` is now `^13.0.1`. Apps that open the same database with their
  own `better-sqlite3` should move to the same major, so a single SQLite build
  touches the file.

### Added

- `RememberResult.similar`: current memories of other types at or above
  `similarityThreshold`, best first, at most 3. Each entry is
  `{ id, similarity, type }`. It is always present, `[]` when nothing matches.
  Wrappers can link these instead of losing them to a merge.

### Fixed

- `link()` resolves superseded IDs to the current version of their chain, so a
  link made with a stale ID no longer lands on a memory nothing reads. When both
  IDs resolve to the same memory, it does nothing instead of creating a
  self-link.
- `remember()` reads each candidate's version in the same query as its vector,
  instead of one extra query per stored memory.

## [0.4.2] - 2026-06-23

### Fixed

- Link expansion scores are now normalized to the same scale as RRF direct-match
  scores. The old formula (`decayedWeight * 0.5`) produced absolute scores ~18×
  higher than any direct match, causing link-expanded results to always outrank
  directly-matched ones. The new formula is
  `result.score * decayedWeight * effective`, where `effective` is the linked
  memory's decayed strength.
- Reinforcement boost is now proportional to result rank (`score / maxScore`)
  and hub-dampened for link-expanded results (`1 / linkCount`). Memories with
  many connections no longer accumulate strength just from being reachable — a
  hub with 78 links receives 1/78 of the normal boost per appearance.
- `SearchResult` now includes an `expanded: boolean` field indicating whether
  the result came from a direct BM25/vector match or from link expansion.

## [0.4.1] - 2026-06-10

### Fixed

- `list()` now persists lazy Ebbinghaus decay back to the database. Previously,
  effective strength was computed on each read but the stored value was never
  updated, so the DB drifted from the true current strength indefinitely.
- `minStrength` and `maxStrength` filters in `list()` now run against the
  effective (decayed) strength rather than the stale stored value. The
  `maxStrength` SQL pre-filter was incorrectly excluding memories whose stored
  strength exceeded the threshold but whose effective strength had decayed below
  it.

## [0.4.0] - 2026-05-25

### Changed

- Reinforcement on read moved from `get()` to `search()`. `get()` is now
  read-only: it returns decayed strength without writing back.
- `reinforce()` uses an inversely proportional boost: `boost * (1 - strength)`,
  so weaker memories receive larger boosts and stronger ones receive smaller
  ones.

## [0.3.0] - 2026-05-21

### Added

- `reindex()` on `MemoryInstance`: finds current memories missing from
  `memory_vectors`, generates embeddings for them, and returns the count of
  reindexed entries.
- `deleteVectors()` on `MemoryInstance`: removes embedding rows by ID, useful
  for testing and repair scenarios.

## [0.2.1] - 2026-05-21

### Fixed

- Links now migrate to the new memory ID when `remember()` auto-versions a
  memory. Previously, links stayed on the old (non-current) ID and became
  unreachable.

## [0.2.0] - 2026-05-21

### Fixed

- `link()` now validates that both `sourceId` and `targetId` exist before
  inserting into `memory_links`. Throws a descriptive error if either ID is not
  found.

## [0.1.2] - 2026-05-20

### Fixed

- `Memory` type is now exported from the package entry point.

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
