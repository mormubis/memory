# Memory Model Improvements & E2E Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the memory model with type-based strengths, versioning auto-boost, and updated decay constants; then build an e2e replay test against real echecs conversations.

**Architecture:** Three independent improvements to the library (typeStrength map, versioning auto-boost, updated defaults), followed by an e2e script that replays 5 real opencode conversations through the opencode SDK with a chess-domain MCP server.

**Tech Stack:** TypeScript (ESM, strict), better-sqlite3, @huggingface/transformers, @opencode-ai/sdk, @modelcontextprotocol/server, zod, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-15-memory-infrastructure-design.md`

---

## File Structure

```
src/
  config.ts                — add typeStrength map, update default decayRate/evictionThreshold
  index.ts                 — versioning auto-boost in remember(), typeStrength lookup
  __tests__/
    config.spec.ts         — add typeStrength tests
    integration.spec.ts    — add auto-boost and typeStrength tests, fix decay constants

scripts/
  mcp.ts                   — update createMemory with typeStrength + new defaults
  replay.ts                — NEW: orchestrates opencode SDK sessions for e2e
  verify.ts                — update search queries + decay simulation for new defaults
```

---

### Task 1: typeStrength config map + updated defaults

**Files:**
- Modify: `src/config.ts`
- Modify: `src/__tests__/config.spec.ts`

- [ ] **Step 1: Add failing tests for typeStrength**

Add to `src/__tests__/config.spec.ts` after the existing tests:

```typescript
  it('returns empty typeStrength when not provided', () => {
    const config = resolveConfig();
    expect(config.typeStrength).toEqual({});
  });

  it('accepts a typeStrength map', () => {
    const config = resolveConfig({
      typeStrength: { rule: 0.6, entity: 0.5 },
    });
    expect(config.typeStrength['rule']).toBe(0.6);
    expect(config.typeStrength['entity']).toBe(0.5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/config.spec.ts`
Expected: FAIL — `config.typeStrength` is undefined

- [ ] **Step 3: Update config.ts**

Add `typeStrength` to both interfaces and update defaults:

In `MemoryConfig`:
```typescript
  typeStrength?: Record<string, number>;
```

In `ResolvedConfig`:
```typescript
  typeStrength: Record<string, number>;
```

In `DEFAULTS`:
```typescript
  decayRate: 0.99,
  defaultStrength: 0.2,
  evictionThreshold: 0.05,
  typeStrength: {},
```

In `resolveConfig`:
```typescript
  typeStrength: input?.typeStrength ?? DEFAULTS.typeStrength,
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- src/__tests__/config.spec.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/__tests__/config.spec.ts
git commit -m "add typeStrength config map, update defaults to decayRate=0.99 evictionThreshold=0.05"
```

---

### Task 2: typeStrength lookup + auto-boost in remember()

**Files:**
- Modify: `src/index.ts`
- Modify: `src/__tests__/integration.spec.ts`

- [ ] **Step 1: Add tests for typeStrength lookup and auto-boost**

Add to `src/__tests__/integration.spec.ts` inside `describe('remember', ...)`:

```typescript
    it('uses typeStrength map when no explicit strength provided', async () => {
      let now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 1.0,
        typeStrength: { rule: 0.6, entity: 0.5 },
      });
      const r1 = await mem.remember('rule', 'castling requires king not in check');
      const r2 = await mem.remember('entity', 'FIDE is the chess governing body');
      const r3 = await mem.remember('fact', 'some untyped memory');

      const m1 = mem.get(r1.id);
      const m2 = mem.get(r2.id);
      const m3 = mem.get(r3.id);

      // rule → 0.6 (reinforced on get, so >= 0.6)
      expect(m1?.strength).toBeGreaterThanOrEqual(0.6);
      // entity → 0.5
      expect(m2?.strength).toBeGreaterThanOrEqual(0.5);
      // fact not in map → defaultStrength 0.2
      expect(m3?.strength).toBeGreaterThanOrEqual(0.2);
      expect(m3?.strength).toBeLessThan(0.5);
    });

    it('auto-boosts strength when creating a new version', async () => {
      let now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 0.0,
        reinforcementBoost: 0.1,
      });

      const v1 = await mem.remember('fact', 'castling rule', 0.2);
      // auto-boost: max(0.2, effective(0.2) + 0.1) = max(0.2, 0.3) = 0.3
      const v2 = await mem.remember('fact', 'castling rule updated', 0.2);
      const m2 = mem.get(v2.id);

      expect(v2.parentId).toBe(v1.id);
      // strength should be at least 0.3 (auto-boost), then reinforced on get
      expect(m2?.strength).toBeGreaterThanOrEqual(0.3);
    });

    it('uses explicit strength when higher than auto-boost', async () => {
      let now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 0.0,
        reinforcementBoost: 0.1,
      });

      await mem.remember('fact', 'castling rule', 0.2);
      // explicit 0.8 > auto-boost (0.3) → stored at 0.8
      const v2 = await mem.remember('fact', 'castling rule updated', 0.8);
      const m2 = mem.get(v2.id);

      expect(m2?.strength).toBeGreaterThanOrEqual(0.8);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/integration.spec.ts`
Expected: FAIL — typeStrength not used, auto-boost not implemented

- [ ] **Step 3: Update remember() in src/index.ts**

Replace the `remember` function body. Key changes:
1. Resolve strength: `strength ?? config.typeStrength[type] ?? config.defaultStrength`
2. On versioning match: fetch previous version's effective strength, compute `max(resolvedStrength, prevEffective + boost)`

```typescript
  async function remember(
    type: string,
    content: string,
    strength?: number,
  ): Promise<RememberResult> {
    const embedding = await embedder.embed(content);

    // Resolve strength: explicit > typeStrength map > defaultStrength
    const resolvedStrength =
      strength ?? config.typeStrength[type] ?? config.defaultStrength;

    // Load all current memories with their vectors
    const vectorRows = db
      .prepare(
        'SELECT mv.memory_id, mv.embedding FROM memory_vectors mv JOIN memories m ON m.id = mv.memory_id WHERE m.current = 1',
      )
      .all() as VectorRow[];

    const candidates = vectorRows.map((row) => ({
      embedding: embedder.fromBlob(row.embedding),
      id: row.memory_id,
      version:
        (
          db
            .prepare('SELECT version FROM memories WHERE id = ?')
            .get(row.memory_id) as { version: number } | undefined
        )?.version ?? 1,
    }));

    const match = findSimilar(
      embedding,
      candidates,
      config.similarityThreshold,
    );

    let result: RememberResult;

    if (match) {
      // Auto-boost: max(resolvedStrength, previous_effective + reinforcementBoost)
      const prevRow = db
        .prepare('SELECT strength, updated FROM memories WHERE id = ?')
        .get(match.id) as { strength: number; updated: string } | undefined;

      const prevEffective = prevRow
        ? effectiveStrength(
            prevRow.strength,
            daysBetween(new Date(prevRow.updated), config.clock()),
            config.decayRate,
          )
        : 0;

      const boostedStrength = Math.min(
        1.0,
        prevEffective + config.reinforcementBoost,
      );
      const finalStrength = Math.max(resolvedStrength, boostedStrength);

      // Mark old as non-current
      db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(match.id);

      result = store.insert({
        content,
        parentId: match.id,
        strength: finalStrength,
        type,
        version: match.version + 1,
      });
    } else {
      result = store.insert({
        content,
        strength: resolvedStrength,
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
```

- [ ] **Step 4: Fix existing tests for new defaults**

The integration test `'filters out evicted memories'` uses `advance(10)` expecting eviction. With `decayRate=0.99` and `evictionThreshold=0.05`, `0.2 * 0.99^10 = 0.181 > 0.05` — not evicted. Fix by advancing 150 days:

```typescript
    it('filters out evicted memories', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'temporary memory', 0.2);
      // 0.2 * 0.99^150 ≈ 0.044 < 0.05
      advance(150);
      const mems = memory.list();
      expect(mems.length).toBe(0);
    });
```

Also fix `'eviction excludes memories from list'`:

```typescript
    it('eviction excludes memories from list', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'very weak memory', 0.16);
      // 0.16 * 0.99^120 ≈ 0.048 < 0.05
      advance(120);
      const mems = memory.list();
      expect(mems.every((m) => m.strength >= 0.05)).toBe(true);
    });
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/__tests__/integration.spec.ts
git commit -m "add typeStrength lookup and versioning auto-boost in remember()"
```

---

### Task 3: update MCP server with chess domain typeStrength

**Files:**
- Modify: `scripts/mcp.ts`

- [ ] **Step 1: Update createMemory call**

Replace the `createMemory` call at the top of `scripts/mcp.ts`:

```typescript
const memory = createMemory({
  path: './echecs-memory.db',
  similarityThreshold: 0.85,
  decayRate: 0.99,
  evictionThreshold: 0.05,
  defaultStrength: 0.2,
  typeStrength: {
    constraint: 0.7,
    decision: 0.7,
    entity: 0.5,
    pattern: 0.5,
    rule: 0.6,
    standard: 0.6,
  },
});
```

Also remove the `strength` parameter from the `memory_remember` tool input — the type carries the strength:

```typescript
server.registerTool(
  'memory_remember',
  {
    title: 'Remember',
    description: 'Store a chess domain memory. Strength is determined by the type.',
    inputSchema: z.object({
      type: z.string().describe('Memory type: rule, entity, standard, decision, constraint, or pattern'),
      content: z.string().describe('The knowledge to store — a clear standalone statement'),
    }),
  },
  async ({ type, content }) => {
    try {
      const result = await memory.remember(type, content);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: result.id, version: result.version, parentId: result.parentId }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/mcp.ts
git commit -m "update MCP server with chess domain typeStrength, remove manual strength param"
```

---

### Task 4: update verify.ts

**Files:**
- Modify: `scripts/verify.ts`

- [ ] **Step 1: Update verify.ts with chess queries and new defaults**

Update `createMemory` call to use same config as MCP server. Update search queries to chess-domain queries. Update decay simulation to use 30d/90d/180d at `decayRate=0.99`. Show top version chains. Show link relation distribution.

See the full replacement content in the plan summary — same `createMemory` config as mcp.ts, 8 chess queries (Buchholz, FIDE Swiss, castling, PGN, Elo, UCI, en passant, Sonneborn-Berger), version chain display, multi-point decay simulation.

- [ ] **Step 2: Verify runs on empty DB**

Run: `rm -f echecs-memory.db && npx tsx scripts/verify.ts`
Expected: all zeros, no errors

- [ ] **Step 3: Commit**

```bash
git add scripts/verify.ts
git commit -m "update verify.ts with chess domain queries and new decay defaults"
```

---

### Task 5: install opencode SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `pnpm add @opencode-ai/sdk`

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "add @opencode-ai/sdk dependency"
```

---

### Task 6: create replay.ts

**Files:**
- Create: `scripts/replay.ts`

The replay script:
1. Reads 5 echecs sessions from opencode db (user + assistant text only, no tool calls, no thinking)
2. Splits into chunks on 2+ minute gaps between messages
3. Starts opencode with MCP pointing at `scripts/mcp.ts`
4. One session per source conversation — feeds all chunks sequentially
5. Extraction system prompt stores every mention of chess domain knowledge via MCP tools
6. After each chunk, session links related memories in that chunk

System prompt guides the agent to:
- Use exactly the 6 chess memory types (rule, entity, standard, decision, constraint, pattern)
- Store every mention — frequency is the signal
- Call `memory_link` with IDs accumulated during the session
- Skip non-chess implementation noise

Message format per chunk:
```
--- chunk 1/N from conversation: "Tournament tiebreaker libraries" ---

[user] let's create tiebreaker libraries...
[assistant] I'll start with Buchholz...
```

Sessions to replay:
- `ses_1f3abe854ffej012scXpwINUbW` — Type redesign for @echecs/tournament v3.0.0
- `ses_241ae2bb2ffeUfb1jQUrZNnqf0` — Tournament debugging: 204 players pairings issue
- `ses_2e8c5ec53ffeM22VfKabLD880j` — Tournament tiebreaker libraries
- `ses_1dd14be28ffeEiEUAOQ2sQ5fH0` — FIDE endorsement requirements checklist
- `ses_21be75bd1ffev51jdwM9s7Rj5C` — @echecs/endorsement CLI package for FIDE Swiss

- [ ] **Step 1: Create scripts/replay.ts**

Full implementation (see plan summary above for extraction system prompt and code structure).

- [ ] **Step 2: Verify parses**

Run: `npx tsx --check scripts/replay.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/replay.ts
git commit -m "add replay.ts e2e orchestrator using opencode SDK"
```

---

### Task 7: run e2e test (manual)

- [ ] **Step 1:** `rm -f echecs-memory.db`
- [ ] **Step 2:** `npx tsx scripts/replay.ts`
- [ ] **Step 3:** `npx tsx scripts/verify.ts`
- [ ] **Step 4:** corroborate search results against known chess knowledge
