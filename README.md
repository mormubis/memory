# @mormubis/memory

Memory infrastructure library. Store, version, search, and decay knowledge over
time.

## Install

```bash
pnpm add @mormubis/memory
```

For default local embeddings (optional):

```bash
pnpm add @huggingface/transformers
```

## Usage

```typescript
import { createMemory } from '@mormubis/memory';

const memory = createMemory({
  path: './memory.db',
  typeStrength: {
    fact: 0.6,
    decision: 0.7,
    observation: 0.3,
  },
});

// Store
const result = await memory.remember(
  'fact',
  'FIDE requires Buchholz as primary tiebreaker',
);
// { id: '...', version: 1, parentId: null, similar: [] }

// Similar content of the same type auto-versions
const v2 = await memory.remember(
  'fact',
  'FIDE requires Buchholz as the primary tiebreaker in Swiss',
);
// { id: '...', version: 2, parentId: result.id, similar: [] }

// Search (BM25 + vector + link expansion)
const results = await memory.search('tiebreaker rules');

// Link
memory.link(result.id, v2.id, 'related_to');

// List, filter, get
const all = memory.list({ type: 'fact', limit: 10 });
const specific = memory.get(result.id);
const chain = memory.history(v2.id);
const linked = memory.related(result.id);

// Delete
memory.forget(result.id);
memory.unlink(result.id, v2.id, 'related_to');
```

## How It Works

Single SQLite file. One table for all memories regardless of type or maturity.

**Versioning** — When you insert content similar to an existing memory of the
same type (cosine similarity above threshold), the library creates a new version
and auto-boosts its strength:
`max(provided, previous_effective + reinforcementBoost)`. Repeated mentions
accumulate strength naturally. Similar memories of other types are never
superseded: `remember()` returns them in `similar` (best first, at most 3) so
the wrapper can link them instead.

**Decay** — Lazy Ebbinghaus-inspired. Strength decays over time:
`effective = strength * decayRate^days`. Computed on read, not stored until
reinforcement or eviction. Memories below `evictionThreshold` are excluded from
search.

**Search** — Hybrid BM25 (FTS5) + vector similarity, fused with reciprocal rank
fusion. Results expanded 1 hop via weighted links. Pure relevance scoring —
strength controls eviction, not ranking.

**Links** — Typed directional edges `(source, target, relation, weight)`.
Weights decay lazily and are reinforced on traversal.

**Types** — Opaque strings. The library stores and filters by type but never
interprets it. Configure default strength per type via `typeStrength`.

## Configuration

```typescript
createMemory({
  path: './memory.db',              // SQLite file path
  embed: async (text) => number[],  // Custom embedding function
  typeStrength: { ... },            // Default strength per type
  defaultStrength: 0.2,             // Fallback when type not in map
  similarityThreshold: 0.85,        // Cosine threshold for auto-versioning
  decayRate: 0.99,                  // Daily decay multiplier (~1% per day)
  reinforcementBoost: 0.1,          // Strength boost on access/versioning
  evictionThreshold: 0.05,          // Strength below which memories are excluded
  searchWeights: { bm25: 0.4, vector: 0.6 },
  rrfK: 60,                         // RRF constant
  linkExpansionHops: 1,             // Link expansion depth in search
  clock: () => new Date(),          // Injectable clock for testing
});
```

## API

| Method                                    | Description                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `remember(type, content, strength?)`      | Insert or auto-version a memory of the same type                           |
| `search(query, options?)`                 | Hybrid BM25 + vector search with link expansion                            |
| `get(id)`                                 | Fetch by ID (reinforces strength if current)                               |
| `list(options?)`                          | List current memories with decay filtering                                 |
| `history(id)`                             | Version chain (newest to oldest)                                           |
| `link(source, target, relation, weight?)` | Create or reinforce a link (superseded IDs resolve to the current version) |
| `unlink(source, target, relation?)`       | Hard delete a link                                                         |
| `related(id, options?)`                   | Get linked memories                                                        |
| `forget(id)`                              | Hard delete a memory, its vector, and links                                |

## Design

Follows the unitary model of memory — one store, not separate short-term and
long-term stores. The difference between a transient observation and durable
knowledge is strength, not location.

Wrapper-agnostic. No opinions on framework, LLM provider, transport layer, or
consolidation strategy. The wrapper imports the library and uses it however it
wants.
