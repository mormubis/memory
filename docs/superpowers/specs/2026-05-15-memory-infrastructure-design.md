# Memory Infrastructure — Design Spec

## Goal

A TypeScript library that provides memory infrastructure. Not specific to AI
agents — any system that needs to store, search, version, and decay knowledge
over time.

Wrapper-agnostic. No opinions on framework, LLM provider, transport layer, or
consolidation strategy. The wrapper imports the library and uses it to store,
retrieve, and manage memories.

## Motivation

Existing memory solutions (agentmemory, mem0, Letta) fuse infrastructure with
product. You can't use the memory engine without buying the whole stack — hooks,
MCP tools, CLI, deployment templates. The core primitives (store, version,
search, decay) are reusable, but they're buried inside opinionated wrappers.

This library extracts those primitives into a standalone package. One import,
one SQLite file, zero opinions about what you build on top.

## What the library owns

- **Single unified store** — one table for all memories, regardless of type or
  maturity. Raw observations and distilled facts live in the same store.
  The difference is strength, not structure.
- **Versioning** — content-similarity-based. On insert, the library compares the
  new content against existing current memories via vector similarity. Above a
  threshold, the new record becomes a new version of the matched memory. Below,
  it's a standalone record.
- **Typed directional links with weights** — `(sourceId, targetId, relation,
  weight)`. Relation is an opaque string. Weight decays lazily and is reinforced
  on traversal.
- **Embedding generation** — the library generates embeddings and stores vectors.
  Ships a default local model, allows overriding with a custom embed function.
- **Hybrid search** — BM25 full-text (FTS5) + vector similarity + link
  expansion, fused with reciprocal rank fusion (RRF).
- **Lazy strength decay** — Ebbinghaus-inspired. Computed on read, not stored
  until reinforcement or eviction. Access reinforces strength. Eviction below
  threshold.
- **SQLite storage** — single file. FTS5 for full-text, sqlite-vec for vectors.

## What the wrapper owns

- **Memory types** — opaque strings. The library stores and filters by type but
  never interprets it. The wrapper defines whatever types make sense for its
  domain (observation, fact, person, workflow, etc.).
- **Link relation vocabulary** — opaque strings. The wrapper defines the
  relations (involves, supersedes, part_of, etc.).
- **Consolidation logic** — when and how to promote weak memories into stronger
  ones. The library doesn't know what consolidation means. The wrapper reads weak
  memories, processes them however it wants (LLM summarization, pattern
  extraction, nothing at all), and inserts the results as stronger memories.
- **Transport layer** — MCP, REST, hooks, CLI, whatever. The library is a
  TypeScript import, not a server.

## Theoretical basis

The design follows the unitary model of memory rather than the multi-store model
(Atkinson-Shiffrin). There is one store, not separate short-term and long-term
stores. The difference between a transient observation and durable knowledge is
activation level (strength), not location. A raw observation starts weak and
decays fast. If consolidated (reinforced, distilled), its strength increases and
it becomes durable. If nobody consolidates it, it decays and gets evicted.

This is consistent with agentmemory's 4-tier model (working, episodic, semantic,
procedural) — the tiers can be represented as types within the unified store.
The library doesn't enforce tiers; the wrapper can implement any tier model it
wants using types and links.

## Schema

### `memories` table

| Column    | Type                       | Description                              |
| --------- | -------------------------- | ---------------------------------------- |
| id        | TEXT PK                    | Auto-generated unique ID                 |
| type      | TEXT NOT NULL               | Opaque string, wrapper-defined           |
| content   | TEXT NOT NULL               | The knowledge — prose, structured, whatever |
| strength  | REAL NOT NULL DEFAULT 0.5  | 0-1, decays over time                   |
| version   | INTEGER NOT NULL DEFAULT 1 | Monotonically increasing per chain       |
| parent_id | TEXT                       | Points to previous version's id          |
| current   | INTEGER NOT NULL DEFAULT 1 | 1 for the head of the version chain      |
| created   | TEXT NOT NULL               | ISO timestamp                            |
| updated   | TEXT NOT NULL               | ISO timestamp                            |

Indexes:
- `(current)` — fast filtering to current versions
- `(type, current)` — fast type-scoped queries
- `(parent_id)` — chain traversal

### `memory_vectors` table

| Column    | Type    | Description                |
| --------- | ------- | -------------------------- |
| memory_id | TEXT PK | References memories.id     |
| embedding | BLOB    | Float32 vector             |

### `memory_links` table

| Column    | Type          | Description                     |
| --------- | ------------- | ------------------------------- |
| source_id | TEXT NOT NULL  | Memory ID                       |
| target_id | TEXT NOT NULL  | Memory ID                       |
| relation  | TEXT NOT NULL  | Opaque string, wrapper-defined  |
| weight    | REAL NOT NULL DEFAULT 1.0 | Decays lazily, reinforced on traversal |
| created   | TEXT NOT NULL  | ISO timestamp                   |
| updated   | TEXT NOT NULL  | ISO timestamp                   |

Primary key: `(source_id, target_id, relation)`.

### FTS index

FTS5 virtual table over `memories.content`. Used for BM25 full-text search.
Kept in sync with inserts and updates to the memories table.

## Versioning

When a new memory is inserted:

1. Generate embedding for the new content.
2. Search existing `current = 1` memories by vector similarity.
3. If the top match is above a configurable threshold:
   - Mark the matched memory as `current = 0`.
   - Create the new record with `parent_id = matched.id`,
     `version = matched.version + 1`, `current = 1`.
4. If no match is above threshold:
   - Create the new record with `parent_id = NULL`, `version = 1`,
     `current = 1`.

The caller doesn't decide whether something is a new version or a new memory.
The library figures it out from content similarity.

### History

Given any memory, the full version chain is accessible by walking `parent_id`
backward. `get(id)` returns any version regardless of `current` status. The
wrapper can access old versions for rollback, comparison, or consolidation
signals (e.g. a memory updated 5 times is more likely to be a stable fact).

## Links

Typed directional edges between memories. The library stores and queries them.
The wrapper defines the relation vocabulary.

`link(sourceId, targetId, relation, weight)` — create or reinforce an edge. If
the edge already exists (same source, target, relation), the weight is updated.

No explicit unlink. Link weights decay lazily (same Ebbinghaus formula as memory
strength). When a link is traversed during search (link expansion), its weight
is reinforced. When weight drops below the eviction threshold, the link is
ignored during expansion.

### Link expansion

After the initial search results (BM25 + vector), the library expands 1 hop
via links:

1. For each result, query `memory_links` for all linked memories (both
   directions).
2. Fetch linked memories (only `current = 1`).
3. Rank linked results by edge weight (after lazy decay).
4. Filter out links below the eviction threshold.
5. Return primary results + linked context, deduplicated.

## Search

Hybrid retrieval combining two signals, plus link expansion:

### BM25

Full-text search via SQLite FTS5 over `content`. Filtered to `current = 1`.
Standard BM25 ranking.

### Vector similarity

Cosine similarity over embeddings in `memory_vectors`. Filtered to `current = 1`.
The library embeds the query using the same model used for storage.

### Fusion

Results from BM25 and vector streams are merged using reciprocal rank fusion
(RRF):

```
score = bm25_weight * 1/(k + bm25_rank) + vector_weight * 1/(k + vector_rank)
```

Default `k = 60`. Default weights: `bm25 = 0.4`, `vector = 0.6`.

After fusion, link expansion adds related memories to the result set.

### Strength as a signal

Search results are weighted by effective strength (after lazy decay). A strong
memory ranks higher than a weak one at the same relevance score. The exact
blending formula is configurable.

## Embedding generation

The library generates embeddings for all memories on insert and for queries on
search. Ships a default local model (`all-MiniLM-L6-v2` via
`@xenova/transformers` or equivalent) so it works out of the box with zero
config and no API keys.

The embed function is overridable:

```typescript
createMemory({
  embed: async (text: string) => number[]
})
```

If provided, the custom function is used instead of the default model. This
allows wrappers to use OpenAI, Cohere, Voyage, or any other provider.

## Strength and decay

### Lazy computation

Strength is not updated on a schedule. The stored value represents strength at
`updated` time. On read, the effective strength is computed:

```
days_since = (now - updated) / (1000 * 60 * 60 * 24)
effective_strength = strength * decay_rate ^ days_since
```

Default `decay_rate = 0.95` (loses ~5% per day). Configurable.

The stored value is only written back when something meaningful happens:
- **Reinforcement** — the memory appears in search results or is accessed via
  `get`. `strength = min(1.0, effective_strength + boost)`. Default
  `boost = 0.1`.
- **Eviction** — `effective_strength < threshold` (default `0.15`). The memory
  is marked `current = 0`. It remains in the database for the version chain but
  is excluded from search.

### Initial strength

The caller provides initial strength on insert. The library doesn't dictate
defaults per type (types are opaque). Typical wrapper patterns:

| Wrapper-defined type | Typical initial strength |
| -------------------- | ----------------------- |
| Raw observation      | 0.2 - 0.3              |
| Session summary      | 0.5 - 0.6              |
| Distilled fact       | 0.7 - 0.8              |
| Architectural decision | 0.9                   |

### Link decay

Links decay with the same formula. Weight replaces strength:

```
effective_weight = weight * decay_rate ^ days_since_updated
```

Reinforcement happens when the link is traversed during search. Dead links
(below threshold) are ignored during expansion.

## API

### Write

**`remember(type, content, strength?)`** — insert a memory. The library:
1. Generates an embedding.
2. Checks for similar existing current memories (vector similarity).
3. Creates a new version or standalone record.
4. Indexes in FTS5.
5. Returns the created memory with its `id`.

**`link(sourceId, targetId, relation, weight?)`** — create or reinforce a
directional edge between two memories.

### Read

**`search(query, options?)`** — hybrid BM25 + vector search with link expansion.
Options: `limit`, `type` filter, `minStrength`, search weights.

**`get(id)`** — fetch a specific memory by ID, regardless of `current` status.
Reinforces strength on access only if the memory is `current = 1`.

**`related(id, options?)`** — get all memories linked to a given memory. Options:
`relation` filter, `minWeight`, `limit`. Returns linked memories ranked by
effective weight.

**`history(id)`** — walk the version chain backward via `parent_id`. Returns all
versions from current to original, newest first.

**`list(options?)`** — list current memories. Options: `type` filter, `limit`,
`minStrength`.

### Delete

**`forget(id)`** — hard delete a memory, its vector, and its links. Intended for
governance (GDPR, etc.), not normal operation. Normal removal is via strength
decay and eviction.

## Configuration

```typescript
createMemory({
  // Storage
  path: './memory.db',              // SQLite file path

  // Embedding
  embed: async (text) => number[],  // Override default local model

  // Versioning
  similarityThreshold: 0.85,        // Vector similarity threshold for versioning

  // Decay
  decayRate: 0.95,                  // Daily decay multiplier
  reinforcementBoost: 0.1,          // Strength boost on access
  evictionThreshold: 0.15,          // Strength below which memories are evicted

  // Search
  searchWeights: {
    bm25: 0.4,
    vector: 0.6,
  },
  rrfK: 60,                         // RRF constant
  linkExpansionHops: 1,              // How many hops to expand during search
})
```

## What this does NOT include

- **Memory type semantics** — types are opaque strings
- **Consolidation logic** — the wrapper decides when/how to promote
- **Transport layer** — no MCP, REST, CLI, or hooks
- **Knowledge graph extraction** — no LLM-driven entity extraction
- **Multi-agent coordination** — no leases, signals, or locks
- **Privacy filtering** — the wrapper strips secrets before inserting
- **Session management** — no session concept in the library

## Success criteria

- Insert 1000 memories with embeddings in under 10 seconds
- Search returns relevant results in under 100ms
- Version chains are correctly maintained via content similarity
- Memories below eviction threshold are excluded from search
- Links decay and reinforce correctly
- BM25 and vector results are fused coherently
- Zero external dependencies beyond SQLite (and optional embedding override)
