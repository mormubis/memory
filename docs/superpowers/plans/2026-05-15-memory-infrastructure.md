# Memory Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript library that provides memory infrastructure — store, version, search, link, and decay knowledge over time.

**Architecture:** Single SQLite file with FTS5 for full-text search and sqlite-vec for vector similarity. One unified store for all memories. Lazy Ebbinghaus decay, content-similarity-based versioning, typed directional links with weight decay, hybrid BM25 + vector search with RRF fusion and link expansion.

**Tech Stack:** TypeScript (ESM, strict), SQLite via `better-sqlite3`, `sqlite-vec` extension, `@xenova/transformers` for default embeddings, vitest for testing, tsdown for building, pnpm as package manager.

**Spec:** `docs/superpowers/specs/2026-05-15-memory-infrastructure-design.md`

---

## File Structure

```
memory/
├── src/
│   ├── index.ts              # Public API: createMemory, types re-export
│   ├── types.ts              # All TypeScript interfaces and types
│   ├── config.ts             # Config defaults, validation, merging
│   ├── id.ts                 # ID generation utility
│   ├── clock.ts              # Clock type and default
│   ├── decay.ts              # Ebbinghaus decay + reinforcement math
│   ├── db.ts                 # SQLite schema creation, migrations
│   ├── store.ts              # Core CRUD: remember, get, list, forget, history
│   ├── versioning.ts         # Similarity detection, version chain logic
│   ├── links.ts              # Link CRUD: link, unlink, related
│   ├── embed.ts              # Embedding: default model + custom override
│   ├── search.ts             # Hybrid search: BM25 + vector + RRF + link expansion
│   ├── __tests__/
│   │   ├── config.spec.ts
│   │   ├── decay.spec.ts
│   │   ├── db.spec.ts
│   │   ├── store.spec.ts
│   │   ├── versioning.spec.ts
│   │   ├── links.spec.ts
│   │   ├── embed.spec.ts
│   │   ├── search.spec.ts
│   │   └── integration.spec.ts
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.mjs
├── eslint.config.mjs
├── prettier.config.mjs
└── .gitignore
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.mjs`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `.gitignore`
- Create: `src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "memory",
  "type": "module",
  "version": "0.0.0",
  "engines": {
    "node": ">=22"
  },
  "packageManager": "pnpm@10.33.0",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["/dist/", "LICENSE"],
  "sideEffects": false,
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint 'src/**/*.ts' '*.mjs' --fix && tsc --noEmit",
    "lint:ci": "eslint 'src/**/*.ts' '*.mjs' --max-warnings 0 && tsc --noEmit",
    "format": "prettier --write '**/*'"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "prettier": "^3.0.0",
    "tsdown": "^0.12.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "allowJs": true,
    "declaration": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "lib": ["ESNext"],
    "module": "NodeNext",
    "moduleDetection": "force",
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist/",
    "resolveJsonModule": true,
    "rootDir": "src/",
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "target": "ESNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create tsdown.config.ts**

```typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  entry: ['src/index.ts'],
  format: 'esm',
  minify: true,
  outDir: 'dist',
  platform: 'node',
  sourcemap: 'hidden',
});
```

- [ ] **Step 4: Create vitest.config.mjs**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/__tests__/**'],
      provider: 'v8',
    },
  },
});
```

- [ ] **Step 5: Create eslint.config.mjs**

```javascript
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import typescript from 'typescript-eslint';

export default typescript.config(
  eslint.configs.recommended,
  ...typescript.configs.strict,
  ...typescript.configs.stylistic,
  {
    rules: {
      'curly': ['error', 'all'],
      'eqeqeq': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    files: ['**/__tests__/**'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  prettier,
);
```

- [ ] **Step 6: Create prettier.config.mjs**

```javascript
export default {
  proseWrap: 'always',
  quoteProps: 'consistent',
  singleQuote: true,
  trailingComma: 'all',
};
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
*.db-wal
```

- [ ] **Step 8: Create src/index.ts placeholder**

```typescript
export {};
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, node_modules populated

- [ ] **Step 10: Verify build works**

Run: `pnpm build`
Expected: `dist/index.js` and `dist/index.d.ts` created

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "scaffold project: package.json, tsconfig, tsdown, vitest, eslint, prettier"
```

---

### Task 2: Types and config

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `src/id.ts`
- Create: `src/clock.ts`
- Test: `src/__tests__/config.spec.ts`

- [ ] **Step 1: Create src/clock.ts**

```typescript
type Clock = () => Date;

const defaultClock: Clock = () => new Date();

export { defaultClock };
export type { Clock };
```

- [ ] **Step 2: Create src/id.ts**

```typescript
import { randomUUID } from 'node:crypto';

function generateId(): string {
  return randomUUID().replace(/-/g, '');
}

export { generateId };
```

- [ ] **Step 3: Create src/types.ts**

```typescript
interface Memory {
  content: string;
  created: string;
  current: boolean;
  id: string;
  parentId: string | null;
  strength: number;
  type: string;
  updated: string;
  version: number;
}

interface MemoryLink {
  created: string;
  relation: string;
  sourceId: string;
  targetId: string;
  updated: string;
  weight: number;
}

interface SearchResult {
  memory: Memory;
  score: number;
}

interface RememberResult {
  id: string;
  parentId: string | null;
  version: number;
}

interface ListOptions {
  limit?: number;
  maxStrength?: number;
  minStrength?: number;
  type?: string;
}

interface SearchOptions {
  limit?: number;
  minStrength?: number;
  type?: string;
  weights?: {
    bm25?: number;
    vector?: number;
  };
}

interface RelatedOptions {
  limit?: number;
  minWeight?: number;
  relation?: string;
}

type EmbedFunction = (text: string) => Promise<number[]>;

export type {
  EmbedFunction,
  ListOptions,
  Memory,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
};
```

- [ ] **Step 4: Create src/config.ts**

```typescript
import { defaultClock } from './clock.js';

import type { Clock } from './clock.js';
import type { EmbedFunction } from './types.js';

interface MemoryConfig {
  clock?: Clock;
  decayRate?: number;
  defaultStrength?: number;
  embed?: EmbedFunction;
  evictionThreshold?: number;
  linkExpansionHops?: number;
  path?: string;
  reinforcementBoost?: number;
  rrfK?: number;
  searchWeights?: {
    bm25?: number;
    vector?: number;
  };
  similarityThreshold?: number;
}

interface ResolvedConfig {
  clock: Clock;
  decayRate: number;
  defaultStrength: number;
  embed: EmbedFunction | null;
  evictionThreshold: number;
  linkExpansionHops: number;
  path: string;
  reinforcementBoost: number;
  rrfK: number;
  searchWeights: {
    bm25: number;
    vector: number;
  };
  similarityThreshold: number;
}

const DEFAULTS: ResolvedConfig = {
  clock: defaultClock,
  decayRate: 0.95,
  defaultStrength: 0.5,
  embed: null,
  evictionThreshold: 0.15,
  linkExpansionHops: 1,
  path: './memory.db',
  reinforcementBoost: 0.1,
  rrfK: 60,
  searchWeights: {
    bm25: 0.4,
    vector: 0.6,
  },
  similarityThreshold: 0.85,
};

function resolveConfig(input?: MemoryConfig): ResolvedConfig {
  return {
    clock: input?.clock ?? DEFAULTS.clock,
    decayRate: input?.decayRate ?? DEFAULTS.decayRate,
    defaultStrength: input?.defaultStrength ?? DEFAULTS.defaultStrength,
    embed: input?.embed ?? DEFAULTS.embed,
    evictionThreshold: input?.evictionThreshold ?? DEFAULTS.evictionThreshold,
    linkExpansionHops: input?.linkExpansionHops ?? DEFAULTS.linkExpansionHops,
    path: input?.path ?? DEFAULTS.path,
    reinforcementBoost:
      input?.reinforcementBoost ?? DEFAULTS.reinforcementBoost,
    rrfK: input?.rrfK ?? DEFAULTS.rrfK,
    searchWeights: {
      bm25: input?.searchWeights?.bm25 ?? DEFAULTS.searchWeights.bm25,
      vector: input?.searchWeights?.vector ?? DEFAULTS.searchWeights.vector,
    },
    similarityThreshold:
      input?.similarityThreshold ?? DEFAULTS.similarityThreshold,
  };
}

export { DEFAULTS, resolveConfig };
export type { MemoryConfig, ResolvedConfig };
```

- [ ] **Step 5: Write the failing test for config**

Create `src/__tests__/config.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { DEFAULTS, resolveConfig } from '../config.js';

describe('resolveConfig', () => {
  it('returns defaults when called with no arguments', () => {
    const config = resolveConfig();
    expect(config.decayRate).toBe(DEFAULTS.decayRate);
    expect(config.defaultStrength).toBe(DEFAULTS.defaultStrength);
    expect(config.evictionThreshold).toBe(DEFAULTS.evictionThreshold);
    expect(config.path).toBe(DEFAULTS.path);
    expect(config.similarityThreshold).toBe(DEFAULTS.similarityThreshold);
    expect(config.embed).toBeNull();
  });

  it('overrides specific values', () => {
    const config = resolveConfig({ decayRate: 0.9, path: ':memory:' });
    expect(config.decayRate).toBe(0.9);
    expect(config.path).toBe(':memory:');
    expect(config.defaultStrength).toBe(DEFAULTS.defaultStrength);
  });

  it('overrides nested search weights', () => {
    const config = resolveConfig({ searchWeights: { bm25: 0.5 } });
    expect(config.searchWeights.bm25).toBe(0.5);
    expect(config.searchWeights.vector).toBe(DEFAULTS.searchWeights.vector);
  });

  it('accepts a custom clock', () => {
    const fixedDate = new Date('2026-01-01');
    const config = resolveConfig({ clock: () => fixedDate });
    expect(config.clock()).toBe(fixedDate);
  });

  it('accepts a custom embed function', () => {
    const embed = async (text: string) => [1, 2, 3];
    const config = resolveConfig({ embed });
    expect(config.embed).toBe(embed);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/config.spec.ts`
Expected: all 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "add types, config, clock, and id utilities"
```

---

### Task 3: Decay math

**Files:**
- Create: `src/decay.ts`
- Test: `src/__tests__/decay.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/decay.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { effectiveStrength, reinforce } from '../decay.js';

describe('effectiveStrength', () => {
  it('returns stored strength when zero days have passed', () => {
    expect(effectiveStrength(0.8, 0, 0.95)).toBe(0.8);
  });

  it('decays over 1 day', () => {
    expect(effectiveStrength(0.8, 1, 0.95)).toBeCloseTo(0.76);
  });

  it('decays over 10 days', () => {
    expect(effectiveStrength(0.8, 10, 0.95)).toBeCloseTo(0.4784);
  });

  it('decays over 30 days', () => {
    const result = effectiveStrength(0.8, 30, 0.95);
    expect(result).toBeCloseTo(0.1732);
  });

  it('returns near-zero for very old memories', () => {
    const result = effectiveStrength(0.5, 100, 0.95);
    expect(result).toBeLessThan(0.01);
  });

  it('never goes below zero', () => {
    expect(effectiveStrength(0.1, 1000, 0.95)).toBeGreaterThanOrEqual(0);
  });
});

describe('reinforce', () => {
  it('boosts effective strength by boost amount', () => {
    expect(reinforce(0.5, 0.1)).toBeCloseTo(0.6);
  });

  it('caps at 1.0', () => {
    expect(reinforce(0.95, 0.1)).toBe(1.0);
  });

  it('caps at 1.0 even with large boost', () => {
    expect(reinforce(0.5, 0.8)).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/decay.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement decay.ts**

Create `src/decay.ts`:

```typescript
function effectiveStrength(
  strength: number,
  daysSince: number,
  decayRate: number,
): number {
  return strength * decayRate ** daysSince;
}

function reinforce(currentStrength: number, boost: number): number {
  return Math.min(1.0, currentStrength + boost);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

export { daysBetween, effectiveStrength, reinforce };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/decay.spec.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add decay math: effectiveStrength, reinforce, daysBetween"
```

---

### Task 4: SQLite schema and database setup

**Files:**
- Create: `src/db.ts`
- Test: `src/__tests__/db.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/db.spec.ts`:

```typescript
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createSchema } from '../db.js';

describe('createSchema', () => {
  it('creates the memories table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the memory_vectors table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vectors'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the memory_links table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_links'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the FTS5 virtual table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    createSchema(db);
    createSchema(db);
    const count = db
      .prepare(
        "SELECT count(*) as c FROM sqlite_master WHERE name='memories'",
      )
      .get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/db.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement db.ts**

Create `src/db.ts`:

```typescript
import type Database from 'better-sqlite3';

function createSchema(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0.5,
      version INTEGER NOT NULL DEFAULT 1,
      parent_id TEXT,
      current INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_current
    ON memories (current)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_type_current
    ON memories (type, current)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_parent_id
    ON memories (parent_id)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation)
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(content, content_rowid='rowid')
  `);
}

export { createSchema };
```

Note: the FTS5 table uses a separate content approach. We will sync it manually on insert/delete. The `content_rowid` mapping will be refined when we implement the store — for now the schema just needs to exist.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/db.spec.ts`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add SQLite schema: memories, memory_vectors, memory_links, memories_fts"
```

---

### Task 5: Core store — remember, get, list, forget, history

**Files:**
- Create: `src/store.ts`
- Test: `src/__tests__/store.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/store.spec.ts`:

```typescript
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../db.js';
import { createStore } from '../store.js';

function setup() {
  const now = new Date('2026-01-01T00:00:00Z');
  const config = resolveConfig({
    clock: () => now,
    path: ':memory:',
  });
  const db = new Database(':memory:');
  createSchema(db);
  return { config, db, now };
}

describe('insert', () => {
  it('inserts a memory and returns its id', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const result = store.insert({
      content: 'auth uses JWT via jose library',
      strength: 0.8,
      type: 'fact',
    });
    expect(result.id).toBeDefined();
    expect(result.version).toBe(1);
    expect(result.parentId).toBeNull();
  });

  it('uses defaultStrength when strength is omitted', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    store.insert({ content: 'some observation', type: 'observation' });
    const memories = store.list();
    expect(memories[0]?.strength).toBe(0.5);
  });
});

describe('get', () => {
  it('retrieves a memory by id', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const { id } = store.insert({
      content: 'test content',
      strength: 0.7,
      type: 'fact',
    });
    const memory = store.get(id);
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe('test content');
    expect(memory?.type).toBe('fact');
    expect(memory?.strength).toBe(0.7);
    expect(memory?.current).toBe(true);
    expect(memory?.version).toBe(1);
  });

  it('returns null for non-existent id', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    expect(store.get('nonexistent')).toBeNull();
  });
});

describe('list', () => {
  it('returns only current memories', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    store.insert({ content: 'first', type: 'fact' });
    store.insert({ content: 'second', type: 'observation' });
    const memories = store.list();
    expect(memories).toHaveLength(2);
    expect(memories.every((m) => m.current)).toBe(true);
  });

  it('filters by type', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    store.insert({ content: 'a fact', type: 'fact' });
    store.insert({ content: 'an observation', type: 'observation' });
    const facts = store.list({ type: 'fact' });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.type).toBe('fact');
  });

  it('respects limit', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    store.insert({ content: 'one', type: 'fact' });
    store.insert({ content: 'two', type: 'fact' });
    store.insert({ content: 'three', type: 'fact' });
    const memories = store.list({ limit: 2 });
    expect(memories).toHaveLength(2);
  });
});

describe('forget', () => {
  it('hard deletes a memory', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const { id } = store.insert({ content: 'to forget', type: 'fact' });
    store.forget(id);
    expect(store.get(id)).toBeNull();
  });

  it('deletes associated FTS entry', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const { id } = store.insert({ content: 'indexed content', type: 'fact' });
    store.forget(id);
    const ftsCount = db
      .prepare("SELECT count(*) as c FROM memories_fts WHERE content MATCH 'indexed'")
      .get() as { c: number };
    expect(ftsCount.c).toBe(0);
  });
});

describe('history', () => {
  it('returns empty array for a v1 memory', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const { id } = store.insert({ content: 'v1 only', type: 'fact' });
    const chain = store.history(id);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.version).toBe(1);
  });

  it('returns null for non-existent id', () => {
    const { config, db } = setup();
    const store = createStore(db, config);
    const chain = store.history('nonexistent');
    expect(chain).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/store.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement store.ts**

Create `src/store.ts`:

```typescript
import { generateId } from './id.js';

import type Database from 'better-sqlite3';
import type { ResolvedConfig } from './config.js';
import type { ListOptions, Memory, RememberResult } from './types.js';

interface InsertInput {
  content: string;
  parentId?: string;
  strength?: number;
  type: string;
  version?: number;
}

interface MemoryRow {
  content: string;
  created: string;
  current: number;
  id: string;
  parent_id: string | null;
  strength: number;
  type: string;
  updated: string;
  version: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    content: row.content,
    created: row.created,
    current: row.current === 1,
    id: row.id,
    parentId: row.parent_id,
    strength: row.strength,
    type: row.type,
    updated: row.updated,
    version: row.version,
  };
}

interface Store {
  forget: (id: string) => void;
  get: (id: string) => Memory | null;
  history: (id: string) => Memory[];
  insert: (input: InsertInput) => RememberResult;
  list: (options?: ListOptions) => Memory[];
}

function createStore(db: Database.Database, config: ResolvedConfig): Store {
  const insertStmt = db.prepare(`
    INSERT INTO memories (id, type, content, strength, version, parent_id, current, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const insertFtsStmt = db.prepare(`
    INSERT INTO memories_fts (rowid, content)
    VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)
  `);

  const getStmt = db.prepare('SELECT * FROM memories WHERE id = ?');

  const deleteFtsStmt = db.prepare(`
    DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)
  `);

  const deleteStmt = db.prepare('DELETE FROM memories WHERE id = ?');

  const deleteVectorStmt = db.prepare(
    'DELETE FROM memory_vectors WHERE memory_id = ?',
  );

  const deleteLinksStmt = db.prepare(
    'DELETE FROM memory_links WHERE source_id = ? OR target_id = ?',
  );

  function insert(input: InsertInput): RememberResult {
    const id = generateId();
    const now = config.clock().toISOString();
    const strength = input.strength ?? config.defaultStrength;
    const version = input.version ?? 1;
    const parentId = input.parentId ?? null;

    insertStmt.run(id, input.type, input.content, strength, version, parentId, now, now);
    insertFtsStmt.run(id, input.content);

    return { id, parentId, version };
  }

  function get(id: string): Memory | null {
    const row = getStmt.get(id) as MemoryRow | undefined;
    if (!row) {
      return null;
    }
    return rowToMemory(row);
  }

  function list(options?: ListOptions): Memory[] {
    const conditions = ['current = 1'];
    const params: unknown[] = [];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options?.minStrength !== undefined) {
      conditions.push('strength >= ?');
      params.push(options.minStrength);
    }

    if (options?.maxStrength !== undefined) {
      conditions.push('strength <= ?');
      params.push(options.maxStrength);
    }

    let sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY updated DESC`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  function forget(id: string): void {
    deleteFtsStmt.run(id);
    deleteVectorStmt.run(id);
    deleteLinksStmt.run(id, id);
    deleteStmt.run(id);
  }

  function history(id: string): Memory[] {
    const start = get(id);
    if (!start) {
      return [];
    }

    const chain: Memory[] = [start];
    let current = start;
    while (current.parentId) {
      const parent = get(current.parentId);
      if (!parent) {
        break;
      }
      chain.push(parent);
      current = parent;
    }

    return chain;
  }

  return { forget, get, history, insert, list };
}

export { createStore };
export type { InsertInput, Store };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/store.spec.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add core store: insert, get, list, forget, history"
```

---

### Task 6: Versioning — similarity detection and version chain

**Files:**
- Create: `src/versioning.ts`
- Test: `src/__tests__/versioning.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/versioning.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { cosineSimilarity, findSimilar } from '../versioning.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('handles high-dimensional vectors', () => {
    const a = Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 384 }, (_, i) => Math.sin(i + 0.1));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });
});

describe('findSimilar', () => {
  it('returns null when no candidates', () => {
    const result = findSimilar([1, 2, 3], [], 0.85);
    expect(result).toBeNull();
  });

  it('returns the most similar candidate above threshold', () => {
    const query = [1, 0, 0];
    const candidates = [
      { embedding: [0, 1, 0], id: 'a', version: 1 },
      { embedding: [0.9, 0.1, 0], id: 'b', version: 2 },
    ];
    const result = findSimilar(query, candidates, 0.5);
    expect(result?.id).toBe('b');
  });

  it('returns null when best match is below threshold', () => {
    const query = [1, 0, 0];
    const candidates = [{ embedding: [0, 1, 0], id: 'a', version: 1 }];
    const result = findSimilar(query, candidates, 0.85);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/versioning.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement versioning.ts**

Create `src/versioning.ts`:

```typescript
interface VersionCandidate {
  embedding: number[];
  id: string;
  version: number;
}

interface SimilarMatch {
  id: string;
  similarity: number;
  version: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    return 0;
  }

  return dot / denom;
}

function findSimilar(
  queryEmbedding: number[],
  candidates: VersionCandidate[],
  threshold: number,
): SimilarMatch | null {
  let best: SimilarMatch | null = null;

  for (const candidate of candidates) {
    const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = {
        id: candidate.id,
        similarity,
        version: candidate.version,
      };
    }
  }

  return best;
}

export { cosineSimilarity, findSimilar };
export type { SimilarMatch, VersionCandidate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/versioning.spec.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add versioning: cosineSimilarity, findSimilar"
```

---

### Task 7: Links — link, unlink, related

**Files:**
- Create: `src/links.ts`
- Test: `src/__tests__/links.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/links.spec.ts`:

```typescript
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../db.js';
import { createLinks } from '../links.js';
import { createStore } from '../store.js';

function setup() {
  const now = new Date('2026-01-01T00:00:00Z');
  const config = resolveConfig({ clock: () => now, path: ':memory:' });
  const db = new Database(':memory:');
  createSchema(db);
  const store = createStore(db, config);
  const links = createLinks(db, config);
  return { config, db, links, now, store };
}

describe('link', () => {
  it('creates a new link', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to', 0.8);
    const related = links.related(a.id);
    expect(related).toHaveLength(1);
    expect(related[0]?.targetId).toBe(b.id);
  });

  it('reinforces weight on duplicate link', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to', 0.5);
    links.link(a.id, b.id, 'related_to', 0.8);
    const related = links.related(a.id);
    expect(related).toHaveLength(1);
    expect(related[0]?.weight).toBe(0.8);
  });

  it('allows multiple relation types between same pair', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to');
    links.link(a.id, b.id, 'causes');
    const related = links.related(a.id);
    expect(related).toHaveLength(2);
  });
});

describe('unlink', () => {
  it('removes a specific link', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to');
    links.unlink(a.id, b.id, 'related_to');
    expect(links.related(a.id)).toHaveLength(0);
  });

  it('removes all links between pair when relation omitted', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to');
    links.link(a.id, b.id, 'causes');
    links.unlink(a.id, b.id);
    expect(links.related(a.id)).toHaveLength(0);
  });
});

describe('related', () => {
  it('returns links in both directions', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to');
    const fromA = links.related(a.id);
    const fromB = links.related(b.id);
    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
  });

  it('filters by relation', () => {
    const { links, store } = setup();
    const a = store.insert({ content: 'memory A', type: 'fact' });
    const b = store.insert({ content: 'memory B', type: 'fact' });
    links.link(a.id, b.id, 'related_to');
    links.link(a.id, b.id, 'causes');
    const related = links.related(a.id, { relation: 'causes' });
    expect(related).toHaveLength(1);
    expect(related[0]?.relation).toBe('causes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/links.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement links.ts**

Create `src/links.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { ResolvedConfig } from './config.js';
import type { MemoryLink, RelatedOptions } from './types.js';

interface LinkRow {
  created: string;
  relation: string;
  source_id: string;
  target_id: string;
  updated: string;
  weight: number;
}

function rowToLink(row: LinkRow): MemoryLink {
  return {
    created: row.created,
    relation: row.relation,
    sourceId: row.source_id,
    targetId: row.target_id,
    updated: row.updated,
    weight: row.weight,
  };
}

interface Links {
  link: (
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ) => void;
  related: (id: string, options?: RelatedOptions) => MemoryLink[];
  unlink: (sourceId: string, targetId: string, relation?: string) => void;
}

function createLinks(db: Database.Database, config: ResolvedConfig): Links {
  const upsertStmt = db.prepare(`
    INSERT INTO memory_links (source_id, target_id, relation, weight, created, updated)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_id, target_id, relation)
    DO UPDATE SET weight = excluded.weight, updated = excluded.updated
  `);

  const unlinkSpecificStmt = db.prepare(
    'DELETE FROM memory_links WHERE source_id = ? AND target_id = ? AND relation = ?',
  );

  const unlinkAllStmt = db.prepare(
    'DELETE FROM memory_links WHERE source_id = ? AND target_id = ?',
  );

  function link(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
  ): void {
    const now = config.clock().toISOString();
    upsertStmt.run(sourceId, targetId, relation, weight, now, now);
  }

  function unlink(
    sourceId: string,
    targetId: string,
    relation?: string,
  ): void {
    if (relation) {
      unlinkSpecificStmt.run(sourceId, targetId, relation);
    } else {
      unlinkAllStmt.run(sourceId, targetId);
    }
  }

  function related(id: string, options?: RelatedOptions): MemoryLink[] {
    const conditions = ['(source_id = ? OR target_id = ?)'];
    const params: unknown[] = [id, id];

    if (options?.relation) {
      conditions.push('relation = ?');
      params.push(options.relation);
    }

    let sql = `SELECT * FROM memory_links WHERE ${conditions.join(' AND ')} ORDER BY weight DESC`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as LinkRow[];
    return rows.map(rowToLink);
  }

  return { link, related, unlink };
}

export { createLinks };
export type { Links };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/links.spec.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add links: link, unlink, related"
```

---

### Task 8: Embedding — default model and custom override

**Files:**
- Create: `src/embed.ts`
- Test: `src/__tests__/embed.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/embed.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { createEmbedder } from '../embed.js';

describe('createEmbedder', () => {
  it('uses custom embed function when provided', async () => {
    const custom = async (_text: string) => [1, 2, 3];
    const embedder = createEmbedder(custom);
    const result = await embedder.embed('test');
    expect(result).toEqual([1, 2, 3]);
  });

  it('stores and retrieves vectors as Float32Array blobs', () => {
    const vector = [0.1, 0.2, 0.3];
    const blob = createEmbedder(null).toBlob(vector);
    expect(blob).toBeInstanceOf(Buffer);
    const restored = createEmbedder(null).fromBlob(blob);
    expect(restored).toHaveLength(3);
    expect(restored[0]).toBeCloseTo(0.1);
    expect(restored[1]).toBeCloseTo(0.2);
    expect(restored[2]).toBeCloseTo(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/embed.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement embed.ts**

Create `src/embed.ts`:

```typescript
import type { EmbedFunction } from './types.js';

interface Embedder {
  embed: (text: string) => Promise<number[]>;
  fromBlob: (blob: Buffer) => number[];
  toBlob: (vector: number[]) => Buffer;
}

function createEmbedder(customEmbed: EmbedFunction | null): Embedder {
  async function embed(text: string): Promise<number[]> {
    if (customEmbed) {
      return customEmbed(text);
    }

    // Lazy-load the default model
    const { pipeline } = await import('@xenova/transformers');
    const extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
    const output = await extractor(text, {
      normalize: true,
      pooling: 'mean',
    });
    return Array.from(output.data as Float32Array);
  }

  function toBlob(vector: number[]): Buffer {
    const float32 = new Float32Array(vector);
    return Buffer.from(float32.buffer);
  }

  function fromBlob(blob: Buffer): number[] {
    const float32 = new Float32Array(
      blob.buffer,
      blob.byteOffset,
      blob.byteLength / 4,
    );
    return Array.from(float32);
  }

  return { embed, fromBlob, toBlob };
}

export { createEmbedder };
export type { Embedder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/embed.spec.ts`
Expected: all tests PASS (custom embed and blob round-trip)

Note: the default `@xenova/transformers` model test is not included here — it requires downloading a model. It will be covered in the integration test (Task 10). Add `@xenova/transformers` to dependencies:

Run: `pnpm add @xenova/transformers`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add embedding: createEmbedder with custom override and blob serialization"
```

---

### Task 9: Search — BM25 + vector + RRF fusion + link expansion

**Files:**
- Create: `src/search.ts`
- Test: `src/__tests__/search.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/search.spec.ts`:

```typescript
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../db.js';
import { createEmbedder } from '../embed.js';
import { createLinks } from '../links.js';
import { createSearch } from '../search.js';
import { createStore } from '../store.js';

// Deterministic fake embedder: uses char codes as dimensions
async function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 8] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / (norm || 1));
}

function setup() {
  const now = new Date('2026-01-01T00:00:00Z');
  const config = resolveConfig({
    clock: () => now,
    embed: fakeEmbed,
    path: ':memory:',
  });
  const db = new Database(':memory:');
  createSchema(db);
  const store = createStore(db, config);
  const links = createLinks(db, config);
  const embedder = createEmbedder(config.embed);
  const search = createSearch(db, config, store, links, embedder);
  return { config, db, embedder, links, search, store };
}

async function insertWithVector(
  store: ReturnType<typeof createStore>,
  embedder: ReturnType<typeof createEmbedder>,
  db: Database.Database,
  input: { content: string; strength?: number; type: string },
) {
  const result = store.insert(input);
  const vector = await embedder.embed(input.content);
  const blob = embedder.toBlob(vector);
  db.prepare('INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)').run(
    result.id,
    blob,
  );
  return result;
}

describe('search', () => {
  it('returns results matching BM25', async () => {
    const { db, embedder, search, store } = setup();
    await insertWithVector(store, embedder, db, {
      content: 'authentication uses JWT tokens',
      type: 'fact',
    });
    await insertWithVector(store, embedder, db, {
      content: 'database uses PostgreSQL',
      type: 'fact',
    });
    const results = await search.search('JWT authentication');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.memory.content).toContain('JWT');
  });

  it('filters by type', async () => {
    const { db, embedder, search, store } = setup();
    await insertWithVector(store, embedder, db, {
      content: 'auth fact',
      type: 'fact',
    });
    await insertWithVector(store, embedder, db, {
      content: 'auth observation',
      type: 'observation',
    });
    const results = await search.search('auth', { type: 'fact' });
    expect(results.every((r) => r.memory.type === 'fact')).toBe(true);
  });

  it('respects limit', async () => {
    const { db, embedder, search, store } = setup();
    for (let i = 0; i < 10; i++) {
      await insertWithVector(store, embedder, db, {
        content: `memory number ${i}`,
        type: 'fact',
      });
    }
    const results = await search.search('memory', { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('excludes non-current memories', async () => {
    const { db, embedder, search, store } = setup();
    const result = await insertWithVector(store, embedder, db, {
      content: 'old version',
      type: 'fact',
    });
    db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(result.id);
    const results = await search.search('old version');
    expect(results.every((r) => r.memory.id !== result.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/search.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement search.ts**

Create `src/search.ts`:

```typescript
import { daysBetween, effectiveStrength } from './decay.js';
import { cosineSimilarity } from './versioning.js';

import type Database from 'better-sqlite3';
import type { ResolvedConfig } from './config.js';
import type { Embedder } from './embed.js';
import type { Links } from './links.js';
import type { Store } from './store.js';
import type { SearchOptions, SearchResult } from './types.js';

interface Search {
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
}

function createSearch(
  db: Database.Database,
  config: ResolvedConfig,
  store: Store,
  links: Links,
  embedder: Embedder,
): Search {
  function searchBm25(
    query: string,
    type?: string,
    limit = 20,
  ): { id: string; rank: number }[] {
    let sql = `
      SELECT m.id, f.rank
      FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH ? AND m.current = 1
    `;
    const params: unknown[] = [query];

    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY f.rank LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as {
      id: string;
      rank: number;
    }[];
    return rows;
  }

  function searchVector(
    queryEmbedding: number[],
    type?: string,
    limit = 20,
  ): { id: string; similarity: number }[] {
    let sql = `
      SELECT v.memory_id, v.embedding, m.current, m.type
      FROM memory_vectors v
      JOIN memories m ON m.id = v.memory_id
      WHERE m.current = 1
    `;
    const params: unknown[] = [];

    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }

    const rows = db.prepare(sql).all(...params) as {
      current: number;
      embedding: Buffer;
      memory_id: string;
      type: string;
    }[];

    const scored = rows
      .map((row) => ({
        id: row.memory_id,
        similarity: cosineSimilarity(
          queryEmbedding,
          embedder.fromBlob(row.embedding),
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored;
  }

  function fuseRrf(
    bm25Results: { id: string; rank: number }[],
    vectorResults: { id: string; similarity: number }[],
    weights: { bm25: number; vector: number },
    k: number,
  ): Map<string, number> {
    const scores = new Map<string, number>();

    bm25Results.forEach((result, index) => {
      const score = weights.bm25 * (1 / (k + index + 1));
      scores.set(result.id, (scores.get(result.id) ?? 0) + score);
    });

    vectorResults.forEach((result, index) => {
      const score = weights.vector * (1 / (k + index + 1));
      scores.set(result.id, (scores.get(result.id) ?? 0) + score);
    });

    return scores;
  }

  function expandLinks(
    ids: string[],
    hops: number,
  ): Map<string, number> {
    const expanded = new Map<string, number>();
    const now = config.clock();

    for (const id of ids) {
      const related = links.related(id);
      for (const link of related) {
        const daysSince = daysBetween(new Date(link.updated), now);
        const weight = effectiveStrength(
          link.weight,
          daysSince,
          config.decayRate,
        );

        if (weight < config.evictionThreshold) {
          continue;
        }

        const linkedId =
          link.sourceId === id ? link.targetId : link.sourceId;

        if (!ids.includes(linkedId)) {
          const existing = expanded.get(linkedId) ?? 0;
          expanded.set(linkedId, Math.max(existing, weight));
        }
      }
    }

    return expanded;
  }

  async function search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 20;
    const weights = {
      bm25: options?.weights?.bm25 ?? config.searchWeights.bm25,
      vector: options?.weights?.vector ?? config.searchWeights.vector,
    };

    // BM25 stream
    const bm25Results = searchBm25(query, options?.type, limit);

    // Vector stream
    const queryEmbedding = await embedder.embed(query);
    const vectorResults = searchVector(queryEmbedding, options?.type, limit);

    // RRF fusion
    const fused = fuseRrf(bm25Results, vectorResults, weights, config.rrfK);

    // Fetch memories and apply strength weighting
    const now = config.clock();
    const results: SearchResult[] = [];

    for (const [id, rrfScore] of fused) {
      const memory = store.get(id);
      if (!memory || !memory.current) {
        continue;
      }

      const daysSince = daysBetween(new Date(memory.updated), now);
      const strength = effectiveStrength(
        memory.strength,
        daysSince,
        config.decayRate,
      );

      if (
        strength < config.evictionThreshold ||
        (options?.minStrength !== undefined && strength < options.minStrength)
      ) {
        continue;
      }

      results.push({
        memory: { ...memory, strength },
        score: rrfScore * strength,
      });
    }

    // Sort by combined score
    results.sort((a, b) => b.score - a.score);

    // Link expansion
    const primaryIds = results.map((r) => r.memory.id);
    const expanded = expandLinks(primaryIds, config.linkExpansionHops);

    for (const [linkedId, linkWeight] of expanded) {
      const memory = store.get(linkedId);
      if (!memory || !memory.current) {
        continue;
      }

      const daysSince = daysBetween(new Date(memory.updated), now);
      const strength = effectiveStrength(
        memory.strength,
        daysSince,
        config.decayRate,
      );

      if (strength < config.evictionThreshold) {
        continue;
      }

      results.push({
        memory: { ...memory, strength },
        score: linkWeight * strength * 0.5, // linked results score lower
      });
    }

    // Final sort and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  return { search };
}

export { createSearch };
export type { Search };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/search.spec.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "add search: BM25 + vector + RRF fusion + link expansion"
```

---

### Task 10: Public API — createMemory and remember with auto-versioning

**Files:**
- Modify: `src/index.ts`
- Test: `src/__tests__/integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/__tests__/integration.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { createMemory } from '../index.js';

// Deterministic fake embedder
async function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 8] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / (norm || 1));
}

function setup() {
  let now = new Date('2026-01-01T00:00:00Z');
  const memory = createMemory({
    clock: () => now,
    embed: fakeEmbed,
    path: ':memory:',
  });
  return {
    advance: (days: number) => {
      now = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    },
    memory,
  };
}

describe('createMemory', () => {
  it('exposes the full API', () => {
    const { memory } = setup();
    expect(memory.remember).toBeDefined();
    expect(memory.get).toBeDefined();
    expect(memory.search).toBeDefined();
    expect(memory.list).toBeDefined();
    expect(memory.forget).toBeDefined();
    expect(memory.history).toBeDefined();
    expect(memory.link).toBeDefined();
    expect(memory.unlink).toBeDefined();
    expect(memory.related).toBeDefined();
  });
});

describe('remember', () => {
  it('inserts a new memory', async () => {
    const { memory } = setup();
    const result = await memory.remember('fact', 'auth uses JWT');
    expect(result.id).toBeDefined();
    expect(result.version).toBe(1);
  });

  it('creates a new version when content is similar', async () => {
    const { memory } = setup();
    await memory.remember('fact', 'auth uses JWT tokens via jose library');
    const v2 = await memory.remember(
      'fact',
      'auth uses JWT tokens via jose library with refresh rotation',
    );
    expect(v2.version).toBe(2);
    expect(v2.parentId).toBeDefined();
  });

  it('creates standalone memory when content is different', async () => {
    const { memory } = setup();
    await memory.remember('fact', 'auth uses JWT tokens');
    const result = await memory.remember('fact', 'database is PostgreSQL on RDS');
    expect(result.version).toBe(1);
    expect(result.parentId).toBeNull();
  });
});

describe('search', () => {
  it('finds relevant memories', async () => {
    const { memory } = setup();
    await memory.remember('fact', 'authentication uses JWT tokens');
    await memory.remember('fact', 'database is PostgreSQL');
    const results = await memory.search('JWT auth');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('decay', () => {
  it('reduces effective strength over time', async () => {
    const { advance, memory } = setup();
    const { id } = await memory.remember('fact', 'temporary info', 0.3);
    advance(30);
    const mem = memory.get(id);
    expect(mem).not.toBeNull();
    // Stored strength is 0.3, but effective after 30 days at 0.95 rate
    // 0.3 * 0.95^30 ≈ 0.065 — below eviction threshold
  });

  it('excludes evicted memories from list', async () => {
    const { advance, memory } = setup();
    await memory.remember('observation', 'raw data', 0.2);
    advance(30);
    // 0.2 * 0.95^30 ≈ 0.043 — below 0.15 threshold
    const listed = memory.list({ type: 'observation' });
    // list should apply decay filtering
    expect(listed).toHaveLength(0);
  });
});

describe('history', () => {
  it('returns the full version chain', async () => {
    const { memory } = setup();
    const v1 = await memory.remember('fact', 'auth uses JWT tokens via jose');
    const v2 = await memory.remember(
      'fact',
      'auth uses JWT tokens via jose with refresh',
    );
    const chain = memory.history(v2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.version).toBe(2);
    expect(chain[1]?.version).toBe(1);
  });
});

describe('links', () => {
  it('creates and queries links', async () => {
    const { memory } = setup();
    const a = await memory.remember('fact', 'auth module');
    const b = await memory.remember('fact', 'user module');
    memory.link(a.id, b.id, 'depends_on', 0.9);
    const related = memory.related(a.id);
    expect(related).toHaveLength(1);
  });

  it('unlinks', async () => {
    const { memory } = setup();
    const a = await memory.remember('fact', 'module A');
    const b = await memory.remember('fact', 'module B');
    memory.link(a.id, b.id, 'related_to');
    memory.unlink(a.id, b.id, 'related_to');
    expect(memory.related(a.id)).toHaveLength(0);
  });
});

describe('forget', () => {
  it('hard deletes a memory', async () => {
    const { memory } = setup();
    const { id } = await memory.remember('fact', 'to be forgotten');
    memory.forget(id);
    expect(memory.get(id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/integration.spec.ts`
Expected: FAIL — createMemory not found

- [ ] **Step 3: Implement the public API in src/index.ts**

```typescript
import Database from 'better-sqlite3';

import { resolveConfig } from './config.js';
import { createSchema } from './db.js';
import { daysBetween, effectiveStrength, reinforce } from './decay.js';
import { createEmbedder } from './embed.js';
import { createLinks } from './links.js';
import { createSearch } from './search.js';
import { createStore } from './store.js';
import { findSimilar } from './versioning.js';

import type { MemoryConfig } from './config.js';
import type {
  ListOptions,
  Memory,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
} from './types.js';

interface MemoryInstance {
  forget: (id: string) => void;
  get: (id: string) => Memory | null;
  history: (id: string) => Memory[];
  link: (
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ) => void;
  list: (options?: ListOptions) => Memory[];
  related: (id: string, options?: RelatedOptions) => MemoryLink[];
  remember: (
    type: string,
    content: string,
    strength?: number,
  ) => Promise<RememberResult>;
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  unlink: (sourceId: string, targetId: string, relation?: string) => void;
}

function createMemory(input?: MemoryConfig): MemoryInstance {
  const config = resolveConfig(input);
  const db = new Database(config.path);
  createSchema(db);

  const store = createStore(db, config);
  const linksModule = createLinks(db, config);
  const embedder = createEmbedder(config.embed);
  const searchModule = createSearch(db, config, store, linksModule, embedder);

  async function remember(
    type: string,
    content: string,
    strength?: number,
  ): Promise<RememberResult> {
    const embedding = await embedder.embed(content);

    // Check for similar existing memories
    const currentMemories = db
      .prepare('SELECT m.id, m.version, v.embedding FROM memories m JOIN memory_vectors v ON v.memory_id = m.id WHERE m.current = 1')
      .all() as { embedding: Buffer; id: string; version: number }[];

    const candidates = currentMemories.map((row) => ({
      embedding: embedder.fromBlob(row.embedding),
      id: row.id,
      version: row.version,
    }));

    const match = findSimilar(
      embedding,
      candidates,
      config.similarityThreshold,
    );

    let result: RememberResult;

    if (match) {
      // Mark old version as not current
      db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(match.id);

      result = store.insert({
        content,
        parentId: match.id,
        strength: strength ?? config.defaultStrength,
        type,
        version: match.version + 1,
      });
    } else {
      result = store.insert({
        content,
        strength: strength ?? config.defaultStrength,
        type,
      });
    }

    // Store embedding
    const blob = embedder.toBlob(embedding);
    db.prepare(
      'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
    ).run(result.id, blob);

    return result;
  }

  function get(id: string): Memory | null {
    const memory = store.get(id);
    if (!memory) {
      return null;
    }

    // Apply lazy decay and reinforcement for current memories
    if (memory.current) {
      const now = config.clock();
      const daysSince = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        daysSince,
        config.decayRate,
      );

      // Check eviction
      if (effective < config.evictionThreshold) {
        db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(id);
        return { ...memory, current: false, strength: effective };
      }

      // Reinforce on access: boost and persist
      const reinforced = reinforce(effective, config.reinforcementBoost);
      const nowIso = now.toISOString();
      db.prepare(
        'UPDATE memories SET strength = ?, updated = ? WHERE id = ?',
      ).run(reinforced, nowIso, id);

      return { ...memory, strength: reinforced, updated: nowIso };
    }

    return memory;
  }

  function list(options?: ListOptions): Memory[] {
    const memories = store.list(options);
    const now = config.clock();

    return memories
      .map((memory) => {
        const daysSince = daysBetween(new Date(memory.updated), now);
        const effective = effectiveStrength(
          memory.strength,
          daysSince,
          config.decayRate,
        );

        if (effective < config.evictionThreshold) {
          db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(
            memory.id,
          );
          return null;
        }

        return { ...memory, strength: effective };
      })
      .filter((m): m is Memory => m !== null);
  }

  return {
    forget: store.forget,
    get,
    history: store.history,
    link: linksModule.link,
    list,
    related: linksModule.related,
    remember,
    search: searchModule.search,
    unlink: linksModule.unlink,
  };
}

export { createMemory };
export type {
  EmbedFunction,
  ListOptions,
  Memory,
  MemoryInstance,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
} from './types.js';
export type { MemoryConfig } from './config.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/integration.spec.ts`
Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all tests across all files PASS

- [ ] **Step 6: Run build**

Run: `pnpm build`
Expected: `dist/` generated with no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "add public API: createMemory with auto-versioning, decay, search, links"
```

---

### Task 11: Lint, format, and final verification

**Files:**
- Possibly modify: any file with lint issues

- [ ] **Step 1: Run formatter**

Run: `pnpm format`

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Fix any issues that come up.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: all tests PASS

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: clean build

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix lint and formatting issues"
```

- [ ] **Step 6: Final verification**

Run: `pnpm lint:ci && pnpm test && pnpm build`
Expected: all three pass with zero warnings
