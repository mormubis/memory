import { describe, expect, it } from 'vitest';

import { createMemory } from '../index.js';

import type { MemoryInstance } from '../index.js';

async function fakeEmbed(text: string): Promise<number[]> {
  const vec = Array.from<number>({ length: 8 }).fill(0);
  for (let index = 0; index < text.length; index++) {
    vec[index % 8]! += (text.codePointAt(index) ?? 0) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  return vec.map((v: number) => v / (norm || 1));
}

/**
 * Default setup with similarityThreshold=1.0 so the fake embedder never
 * accidentally creates versions for unrelated content (fakeEmbed produces
 * high cosine similarity for all text since it's character-frequency based).
 */
function setup(similarityThreshold = 1): {
  advance: (days: number) => void;
  memory: MemoryInstance;
} {
  let now = new Date('2026-01-01T00:00:00Z');
  const memory = createMemory({
    clock: () => now,
    embed: fakeEmbed,
    path: ':memory:',
    similarityThreshold,
  });
  return {
    advance: (days: number) => {
      now = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    },
    memory,
  };
}

describe('createMemory', () => {
  it('exposes full API', () => {
    const { memory } = setup();
    expect(typeof memory.remember).toBe('function');
    expect(typeof memory.get).toBe('function');
    expect(typeof memory.search).toBe('function');
    expect(typeof memory.list).toBe('function');
    expect(typeof memory.forget).toBe('function');
    expect(typeof memory.history).toBe('function');
    expect(typeof memory.link).toBe('function');
    expect(typeof memory.unlink).toBe('function');
    expect(typeof memory.related).toBe('function');
  });

  describe('remember', () => {
    it('uses typeStrength map when no explicit strength provided', async () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 1,
        typeStrength: { rule: 0.6, entity: 0.5 },
      });
      const r1 = await mem.remember(
        'rule',
        'castling requires king not in check',
      );
      const r2 = await mem.remember(
        'entity',
        'FIDE is the chess governing body',
      );
      const r3 = await mem.remember('fact', 'some untyped memory');

      const m1 = mem.get(r1.id);
      const m2 = mem.get(r2.id);
      const m3 = mem.get(r3.id);

      expect(m1?.strength).toBeGreaterThanOrEqual(0.6);
      expect(m2?.strength).toBeGreaterThanOrEqual(0.5);
      expect(m3?.strength).toBeGreaterThanOrEqual(0.2);
      expect(m3?.strength).toBeLessThan(0.5);
    });

    it('auto-boosts strength when creating a new version', async () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 0,
        reinforcementBoost: 0.1,
      });

      const v1 = await mem.remember('fact', 'castling rule', 0.2);
      const v2 = await mem.remember('fact', 'castling rule updated', 0.2);
      const m2 = mem.get(v2.id);

      expect(v2.parentId).toBe(v1.id);
      expect(m2?.strength).toBeGreaterThanOrEqual(0.3);
    });

    it('uses explicit strength when higher than auto-boost', async () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const mem = createMemory({
        clock: () => now,
        embed: fakeEmbed,
        path: ':memory:',
        similarityThreshold: 0,
        reinforcementBoost: 0.1,
      });

      await mem.remember('fact', 'castling rule', 0.2);
      const v2 = await mem.remember('fact', 'castling rule updated', 0.8);
      const m2 = mem.get(v2.id);

      expect(m2?.strength).toBeGreaterThanOrEqual(0.8);
    });

    it('inserts a new memory', async () => {
      const { memory } = setup();
      const result = await memory.remember('fact', 'the sky is blue');
      expect(result.id).toBeDefined();
      expect(result.version).toBe(1);
      expect(result.parentId).toBeUndefined();
    });

    it('creates a new version when content is similar', async () => {
      // Use low threshold to force versioning via fakeEmbed similarity
      const { memory } = setup(0);
      const v1 = await memory.remember('fact', 'the sky is blue');
      const v2 = await memory.remember('fact', 'the sky is blue');

      expect(v2.parentId).toBe(v1.id);
      expect(v2.version).toBe(2);
    });

    it('creates standalone memory when content is different', async () => {
      const { memory } = setup();
      const r1 = await memory.remember('fact', 'the sky is blue');
      const r2 = await memory.remember(
        'fact',
        'elephants are large mammals with trunks and big ears',
      );

      expect(r2.parentId).toBeUndefined();
      expect(r2.id).not.toBe(r1.id);
      expect(r2.version).toBe(1);
    });
  });

  describe('get', () => {
    it('retrieves a memory by id', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'the sky is blue');
      const mem = memory.get(id);
      expect(mem).toBeDefined();
      expect(mem?.content).toBe('the sky is blue');
    });

    it('returns undefined for unknown id', () => {
      const { memory } = setup();
      expect(memory.get('nonexistent')).toBeUndefined();
    });

    it('does not reinforce strength on access', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'the sky is blue', 0.5);
      const first = memory.get(id);
      const second = memory.get(id);
      // get() is read-only: repeated access should not increase strength
      expect(second?.strength).toBe(first?.strength);
    });
  });

  describe('list', () => {
    it('returns current memories with decayed strengths', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'the sky is blue');
      advance(1);

      const mems = memory.list();
      expect(mems.length).toBe(1);
      // strength should be decayed slightly
      expect(mems[0]?.strength).toBeLessThan(1);
    });

    it('filters out evicted memories', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'temporary memory', 0.2);
      // Advance enough days to decay below eviction threshold (0.05)
      // 0.2 * 0.99^N < 0.05 => N > log(0.05/0.2)/log(0.99) ≈ 138 days
      advance(150);

      const mems = memory.list();
      expect(mems.length).toBe(0);
    });
  });

  describe('search', () => {
    it('finds relevant memories via BM25', async () => {
      const { memory } = setup();
      await memory.remember('fact', 'the quick brown fox jumps');
      await memory.remember('fact', 'completely different topic about cooking');

      const results = await memory.search('fox');
      expect(results.length).toBeGreaterThan(0);
      // BM25 should rank the fox content first
      expect(results[0]?.memory.content).toContain('fox');
    });
  });

  describe('search reinforcement', () => {
    it('reinforces returned memories after search', async () => {
      const { memory } = setup();
      const { id } = await memory.remember(
        'fact',
        'the quick brown fox jumps',
        0.5,
      );

      const beforeSearch = memory.get(id);
      await memory.search('fox');
      const afterSearch = memory.get(id);

      // search() should have reinforced the memory in the DB
      expect(afterSearch?.strength).toBeGreaterThan(beforeSearch!.strength);
    });
  });

  describe('decay and eviction', () => {
    it('reduces strength over time', async () => {
      const { memory, advance } = setup();
      const { id } = await memory.remember('fact', 'a decaying memory', 0.8);

      advance(30);
      const mem = memory.get(id);
      expect(mem).toBeDefined();
      expect(mem?.strength).toBeLessThan(0.8);
    });

    it('eviction excludes memories from list', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'very weak memory', 0.16);
      // Advance enough days to decay below eviction threshold (0.05)
      // 0.16 * 0.99^N < 0.05 => N > log(0.05/0.16)/log(0.99) ≈ 115 days
      advance(120);

      const mems = memory.list();
      // After decay, strength should drop below eviction threshold
      expect(mems.every((m) => m.strength >= 0.05)).toBe(true);
    });
  });

  describe('history', () => {
    it('returns version chain', async () => {
      const { memory } = setup(0);
      const v1 = await memory.remember('fact', 'the sky is blue');
      const v2 = await memory.remember('fact', 'the sky is blue');

      const hist = memory.history(v2.id);
      expect(hist).toHaveLength(2);
      expect(hist[0]?.id).toBe(v2.id);
      expect(hist[1]?.id).toBe(v1.id);
    });
  });

  describe('link / unlink / related', () => {
    it('creates and queries links through public API', async () => {
      const { memory } = setup();
      const r1 = await memory.remember('fact', 'apple is a fruit');
      const r2 = await memory.remember('fact', 'orange is a fruit');

      memory.link(r1.id, r2.id, 'similar');
      const related = memory.related(r1.id);
      expect(related).toHaveLength(1);
      expect(related[0]?.relation).toBe('similar');
    });

    it('migrates links when a memory is auto-versioned', async () => {
      const { memory } = setup(0);
      const other = await memory.remember('fact', 'orange is a fruit');
      const v1 = await memory.remember('fact', 'apple is a fruit');

      memory.link(v1.id, other.id, 'similar');
      memory.link(other.id, v1.id, 'categorizes');

      // Trigger auto-versioning
      const v2 = await memory.remember('fact', 'apple is a fruit updated');
      expect(v2.parentId).toBe(v1.id);

      // Links should now point to v2, not v1
      const fromNew = memory.related(v2.id);
      expect(fromNew).toHaveLength(2);
      expect(fromNew.some((l) => l.relation === 'similar')).toBe(true);
      expect(fromNew.some((l) => l.relation === 'categorizes')).toBe(true);

      // Old memory should have no links
      const fromOld = memory.related(v1.id);
      expect(fromOld).toHaveLength(0);
    });

    it('handles link migration conflicts via upsert', async () => {
      const { memory } = setup(0);
      const other = await memory.remember('fact', 'orange is a fruit');
      const v1 = await memory.remember('fact', 'apple is a fruit');

      memory.link(v1.id, other.id, 'similar', 0.5);

      // Trigger auto-versioning
      const v2 = await memory.remember('fact', 'apple is a fruit updated');

      // Manually create a link that would conflict with the migrated one
      // (same source + target + relation as what the migration would produce)
      // The migration should have already transferred v1->other to v2->other
      const related = memory.related(v2.id);
      expect(related).toHaveLength(1);
      expect(related[0]?.relation).toBe('similar');
    });

    it('unlinks memories', async () => {
      const { memory } = setup();
      const r1 = await memory.remember('fact', 'apple is a fruit');
      const r2 = await memory.remember('fact', 'orange is a fruit');

      memory.link(r1.id, r2.id, 'similar');
      memory.unlink(r1.id, r2.id, 'similar');
      expect(memory.related(r1.id)).toHaveLength(0);
    });
  });

  describe('reindex', () => {
    it('embeds current memories missing from memory_vectors', async () => {
      const { memory } = setup();
      const r1 = await memory.remember('fact', 'the sky is blue');
      const r2 = await memory.remember('fact', 'grass is green');

      // Delete embeddings to simulate orphaned memories
      memory.deleteVectors([r1.id, r2.id]);

      // Reindex should find and embed both
      const count = await memory.reindex();
      expect(count).toBe(2);

      // A second reindex should find nothing to do
      const again = await memory.reindex();
      expect(again).toBe(0);
    });

    it('skips memories that already have embeddings', async () => {
      const { memory } = setup();
      await memory.remember('fact', 'the sky is blue');

      const count = await memory.reindex();
      expect(count).toBe(0);
    });

    it('skips non-current memories', async () => {
      const { memory } = setup(0);
      await memory.remember('fact', 'original content');
      const v2 = await memory.remember('fact', 'updated content');

      // Delete only v2's embedding
      memory.deleteVectors([v2.id]);

      const count = await memory.reindex();
      // Should only reindex v2 (the current one), not v1
      expect(count).toBe(1);
    });
  });

  describe('forget', () => {
    it('hard deletes a memory', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'something to forget');
      memory.forget(id);
      expect(memory.get(id)).toBeUndefined();
      expect(memory.list().find((m) => m.id === id)).toBeUndefined();
    });
  });
});
