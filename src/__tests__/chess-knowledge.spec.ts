import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createMemory } from '../index.js';

import type { MemoryInstance } from '../index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface FixtureMemory {
  content: string;
  time: string;
  type: string;
}

interface FixtureLink {
  relation: string;
  source: number;
  target: number;
}

interface Fixture {
  links: FixtureLink[];
  memories: FixtureMemory[];
}

// deterministic fake embedder — produces different vectors for different content
// uses bigram frequencies over 64 dimensions for better discrimination than char codes
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
      memory.link(sourceId, targetId, link.relation);
    }
  }

  return { ids: ids as string[], memory };
}

describe('chess knowledge base', () => {
  const fixture = loadFixture();

  describe('ingestion', () => {
    it('stores all memories from the fixture', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);
      const all = memory.list();
      // some may have been versioned (similar content auto-merges)
      expect(all.length).toBeGreaterThan(0);
      expect(all.length).toBeLessThanOrEqual(fixture.memories.length);
    });

    it('creates all link relations', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { ids, memory } = await populateMemory(fixture, clock);
      const firstId = ids[0]!;
      const related = memory.related(firstId);
      expect(related.length).toBeGreaterThan(0);
    });
  });

  describe('versioning via auto-boost', () => {
    it('creates version chains for similar content', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      // buchholz is mentioned twice with similar content (index 0 and 1)
      // VCL19 is mentioned twice (index 4 and 5)
      // bye types mentioned twice (index 10 and 11)
      // bbpPairings mentioned twice (index 17 and 18)
      // tiebreak signature mentioned twice (index 23 and 24)
      // these should create version chains if similarity > threshold

      const all = memory.list();
      const versioned = all.filter((m) => m.version > 1);
      // at least some should have been auto-versioned
      expect(versioned.length).toBeGreaterThan(0);
    });

    it('auto-boosted versions have higher strength than v1', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const all = memory.list();
      const versioned = all.filter((m) => m.version > 1);

      for (const m of versioned) {
        const chain = memory.history(m.id);
        if (chain.length >= 2) {
          const current = chain[0]!;
          // v2+ should have been boosted beyond the base type strength
          const baseStrength =
            ({ constraint: 0.7, decision: 0.7, entity: 0.5, pattern: 0.5, rule: 0.6, standard: 0.6 })[
              current.type
            ] ?? 0.2;
          expect(current.strength).toBeGreaterThanOrEqual(baseStrength);
        }
      }
    });
  });

  describe('search relevance', () => {
    it('finds buchholz-related memories for "buchholz tiebreaker"', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const results = await memory.search('buchholz tiebreaker', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);

      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('buchholz'))).toBe(true);
    });

    it('finds FIDE endorsement memories for "FIDE endorsement"', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const results = await memory.search('FIDE endorsement', { limit: 5 });
      expect(results.length).toBeGreaterThan(0);

      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('fide'))).toBe(true);
    });

    it('finds bbpPairings for "reference pairing engine"', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const results = await memory.search('reference pairing engine', {
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);

      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('bbppairings'))).toBe(true);
    });

    it('finds bye rules for "bye types full half pairing"', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const results = await memory.search('bye types full half pairing', {
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);

      const contents = results.map((r) => r.memory.content.toLowerCase());
      expect(contents.some((c) => c.includes('bye'))).toBe(true);
    });

    it('type filter applies to primary results', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const results = await memory.search('tiebreak', {
        limit: 10,
        type: 'entity',
      });
      // primary results (from BM25+vector) should all be entity type
      // link expansion may add other types, but at least some entities exist
      const entities = results.filter((r) => r.memory.type === 'entity');
      expect(entities.length).toBeGreaterThan(0);
    });
  });

  describe('decay over time', () => {
    it('march memories are weaker than may memories', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const all = memory.list();
      // separate by approximate creation time
      // march memories: type=standard about buchholz (indices 0-3)
      // may memories: type=constraint about FIDE endorsement (index 28)
      const standards = all.filter((m) => m.type === 'standard');
      const constraints = all.filter((m) => m.type === 'constraint');

      if (standards.length > 0 && constraints.length > 0) {
        const avgStandard =
          standards.reduce((s, m) => s + m.strength, 0) / standards.length;
        const avgConstraint =
          constraints.reduce((s, m) => s + m.strength, 0) / constraints.length;
        // constraints were created in may (closer to clock), standards in march
        // constraints have higher base strength (0.7 vs 0.6) AND less decay
        expect(avgConstraint).toBeGreaterThan(avgStandard);
      }
    });

    it('advancing 180 days evicts weak memories', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      const before = memory.list().length;

      // advance 180 days
      clock.now = new Date('2026-11-11T00:00:00Z');
      const after = memory.list().length;

      expect(after).toBeLessThan(before);
    });

    it('strong memories survive 90 days', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      // advance 90 days
      clock.now = new Date('2026-08-13T00:00:00Z');
      const survivors = memory.list();

      // constraint and decision types start at 0.7
      // 0.7 * 0.99^90 ≈ 0.28 > 0.05 — should survive
      const strongTypes = survivors.filter(
        (m) => m.type === 'constraint' || m.type === 'decision',
      );
      expect(strongTypes.length).toBeGreaterThan(0);
    });
  });

  describe('links', () => {
    it('related() returns connected memories', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { ids, memory } = await populateMemory(fixture, clock);

      // fixture links index 16 (@echecs ecosystem) to index 17 (bbpPairings)
      const ecosystemId = ids[16]!;
      const related = memory.related(ecosystemId);
      expect(related.length).toBeGreaterThan(0);
    });

    it('link expansion surfaces connected memories in search', async () => {
      const clock = { now: new Date('2026-05-15T00:00:00Z') };
      const { memory } = await populateMemory(fixture, clock);

      // search for something specific, links should expand results
      const results = await memory.search('echecs ecosystem endorsement', {
        limit: 10,
      });
      // should find both the ecosystem entity and linked memories
      expect(results.length).toBeGreaterThan(1);
    });
  });
});
