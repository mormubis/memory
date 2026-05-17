# Changelog

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
