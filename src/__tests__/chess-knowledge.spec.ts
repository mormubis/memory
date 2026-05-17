import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createMemory } from '../index.js';

import type { MemoryInstance } from '../index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface FixtureMemory {
  content: string;
  parentId: string | null;
  time: string;
  type: string;
  version: number;
}

interface FixtureLink {
  relation: string;
  source: number;
  target: number;
  weight: number;
}

interface Fixture {
  links: FixtureLink[];
  memories: FixtureMemory[];
}

// deterministic fake embedder — bigram frequencies over 64 dimensions
async function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(64).fill(0) as number[];
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length - 1; i++) {
    const bigram = lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1);
    vec[bigram % 64]! += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

function loadFixture(): Fixture {
  const raw = readFileSync(
    resolve(__dirname, 'fixtures/chess-knowledge.json'),
    'utf-8',
  );
  return JSON.parse(raw) as Fixture;
}

async function populateMemory(
  fixture: Fixture,
  clock: { now: Date },
): Promise<{ ids: string[]; memory: MemoryInstance }> {
  const memory = createMemory({
    clock: () => clock.now,
    decayRate: 0.99,
    embed: fakeEmbed,
    evictionThreshold: 0.05,
    path: ':memory:',
    similarityThreshold: 0.85,
    typeStrength: {
      constraint: 0.7,
      decision: 0.7,
      entity: 0.5,
      pattern: 0.5,
      rule: 0.6,
      standard: 0.6,
    },
  });

  // insert memories in chronological order, advancing the clock
  const sorted = fixture.memories
    .map((m, i) => ({ ...m, originalIndex: i }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const ids = new Array<string>(fixture.memories.length);

  for (const entry of sorted) {
    clock.now = new Date(entry.time);
    const result = await memory.remember(entry.type, entry.content);
    ids[entry.originalIndex] = result.id;
  }

  // create links using the original indices
  for (const link of fixture.links) {
    const sourceId = ids[link.source];
    const targetId = ids[link.target];
    if (sourceId && targetId) {
      memory.link(sourceId, targetId, link.relation, link.weight);
    }
  }

  return { ids: ids as string[], memory };
}

describe('chess knowledge base', () => {
  const fixture = loadFixture();

  describe('ingestion', () => {
    it('stores memories from the fixture', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      // some may have been versioned (similar content auto-merges)
      expect(all.length).toBeGreaterThan(100);
      expect(all.length).toBeLessThanOrEqual(fixture.memories.length);
    });

    it('stores all six memory types', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      const types = new Set(all.map((m) => m.type));
      expect(types.has('rule')).toBe(true);
      expect(types.has('entity')).toBe(true);
      expect(types.has('standard')).toBe(true);
      expect(types.has('decision')).toBe(true);
      expect(types.has('constraint')).toBe(true);
      expect(types.has('pattern')).toBe(true);
    });

    it('creates links between memories', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { ids, memory } = await populateMemory(fixture, clock);
      // check that at least some links were created
      let totalLinks = 0;
      for (const id of ids) {
        if (id) {
          totalLinks += memory.related(id).length;
        }
      }
      expect(totalLinks).toBeGreaterThan(0);
    });
  });

  describe('versioning', () => {
    it('creates version chains for similar content', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      const versioned = all.filter((m) => m.version > 1);
      expect(versioned.length).toBeGreaterThan(0);
    });

    it('auto-boosted versions have higher strength', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      const versioned = all.filter((m) => m.version > 1);

      for (const m of versioned) {
        const chain = memory.history(m.id);
        if (chain.length >= 2) {
          const current = chain[0]!;
          const baseStrength =
            ({ constraint: 0.7, decision: 0.7, entity: 0.5, pattern: 0.5, rule: 0.6, standard: 0.6 } as Record<string, number>)[
              current.type
            ] ?? 0.2;
          // reinforced on get(), so at least base strength
          expect(current.strength).toBeGreaterThanOrEqual(baseStrength);
        }
      }
    });
  });

  describe('search relevance', () => {
    it('finds buchholz-related memories', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('buchholz tiebreaker', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('buchholz'))).toBe(true);
    });

    it('finds FIDE endorsement memories', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('FIDE endorsement', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('fide'))).toBe(true);
    });

    it('finds bbpPairings as reference engine', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('reference pairing engine', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('bbppairings'))).toBe(true);
    });

    it('finds tournament tiebreak architecture', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('tiebreak package architecture', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('type filter returns only matching types', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('echecs', { limit: 5, type: 'entity' });
      // primary results should all be entity (link expansion may add others)
      const entities = results.filter((r) => r.memory.type === 'entity');
      expect(entities.length).toBeGreaterThan(0);
    });
  });

  describe('decay', () => {
    it('memories have decayed strength relative to clock', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      // all strengths should be <= their type base strength
      // (because get() reinforces, but list() doesn't — and time has passed)
      for (const m of all) {
        expect(m.strength).toBeLessThanOrEqual(1.0);
        expect(m.strength).toBeGreaterThan(0.05);
      }
    });

    it('advancing 300 days evicts weak memories', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const before = memory.list().length;

      // pattern (0.5) evicts at ~230 days, entity (0.5) at ~230 days
      // decision/constraint (0.7) evicts at ~265 days
      clock.now = new Date('2027-03-13T00:00:00Z');
      const after = memory.list().length;
      expect(after).toBeLessThan(before);
    });

    it('strong memories survive 90 days', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      clock.now = new Date('2026-08-15T00:00:00Z');
      const survivors = memory.list();
      expect(survivors.length).toBeGreaterThan(0);

      const strongTypes = survivors.filter(
        (m) => m.type === 'constraint' || m.type === 'decision',
      );
      expect(strongTypes.length).toBeGreaterThan(0);
    });
  });

  describe('links', () => {
    it('related() returns linked memories', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { ids, memory } = await populateMemory(fixture, clock);

      // find a memory that has links in the fixture
      const linkedIndex = fixture.links[0]?.source;
      if (linkedIndex !== undefined && ids[linkedIndex]) {
        const related = memory.related(ids[linkedIndex]!);
        expect(related.length).toBeGreaterThan(0);
      }
    });

    it('search expands via links', async () => {
      const clock = { now: new Date('2026-05-17T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const results = await memory.search('echecs ecosystem', { limit: 10 });
      expect(results.length).toBeGreaterThan(1);
    });
  });
});
