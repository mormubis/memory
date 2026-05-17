# @mormubis/memory

memory infrastructure library. store, version, search, and decay knowledge over
time.

## install

```bash
pnpm add @mormubis/memory
```

for default local embeddings (optional):

```bash
pnpm add @huggingface/transformers
```

## usage

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

// store
const result = await memory.remember('fact', 'FIDE requires Buchholz as primary tiebreaker');
// { id: '...', version: 1, parentId: null }

// similar content auto-versions
const v2 = await memory.remember('fact', 'FIDE requires Buchholz as the primary tiebreaker in Swiss');
// { id: '...', version: 2, parentId: result.id }

// search (BM25 + vector + link expansion)
const results = await memory.search('tiebreaker rules');

// link
memory.link(result.id, v2.id, 'related_to');

// list, filter, get
const all = memory.list({ type: 'fact', limit: 10 });
const specific = memory.get(result.id);
const chain = memory.history(v2.id);
const linked = memory.related(result.id);

// delete
memory.forget(result.id);
memory.unlink(result.id, v2.id, 'related_to');
```

## how it works

single SQLite file. one table for all memories regardless of type or maturity.

**versioning** — when you insert content similar to an existing memory (cosine
similarity above threshold), the library creates a new version and auto-boosts
its strength: `max(provided, previous_effective + reinforcementBoost)`. repeated
mentions accumulate strength naturally.

**decay** — lazy Ebbinghaus-inspired. strength decays over time:
`effective = strength * decayRate^days`. computed on read, not stored until
reinforcement or eviction. memories below `evictionThreshold` are excluded from
search.

**search** — hybrid BM25 (FTS5) + vector similarity, fused with reciprocal rank
fusion. results expanded 1 hop via weighted links. pure relevance scoring —
strength controls eviction, not ranking.

**links** — typed directional edges `(source, target, relation, weight)`.
weights decay lazily and are reinforced on traversal.

**types** — opaque strings. the library stores and filters by type but never
interprets it. configure default strength per type via `typeStrength`.

## config

```typescript
createMemory({
  path: './memory.db',              // SQLite file path
  embed: async (text) => number[],  // custom embedding function
  typeStrength: { ... },            // default strength per type
  defaultStrength: 0.2,             // fallback when type not in map
  similarityThreshold: 0.85,        // cosine threshold for auto-versioning
  decayRate: 0.99,                  // daily decay multiplier (~1% per day)
  reinforcementBoost: 0.1,          // strength boost on access/versioning
  evictionThreshold: 0.05,          // strength below which memories are excluded
  searchWeights: { bm25: 0.4, vector: 0.6 },
  rrfK: 60,                         // RRF constant
  linkExpansionHops: 1,             // link expansion depth in search
  clock: () => new Date(),          // injectable clock for testing
});
```

## api

| method | description |
|--------|-------------|
| `remember(type, content, strength?)` | insert or auto-version a memory |
| `search(query, options?)` | hybrid BM25 + vector search with link expansion |
| `get(id)` | fetch by id (reinforces strength if current) |
| `list(options?)` | list current memories with decay filtering |
| `history(id)` | version chain (newest to oldest) |
| `link(source, target, relation, weight?)` | create or reinforce a link |
| `unlink(source, target, relation?)` | hard delete a link |
| `related(id, options?)` | get linked memories |
| `forget(id)` | hard delete a memory, its vector, and links |

## design

follows the unitary model of memory — one store, not separate short-term and
long-term stores. the difference between a transient observation and durable
knowledge is strength, not location.

wrapper-agnostic. no opinions on framework, LLM provider, transport layer, or
consolidation strategy. the wrapper imports the library and uses it however it
wants.

see [design spec](docs/superpowers/specs/2026-05-15-memory-infrastructure-design.md)
for the full architecture.
