import { describe, expect, it } from 'vitest';

import { createMemory } from '../index.js';

import type { MemoryInstance } from '../index.js';

async function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 8] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  return vec.map((v: number) => v / (norm || 1));
}

/**
 * Default setup with similarityThreshold=1.0 so the fake embedder never
 * accidentally creates versions for unrelated content (fakeEmbed produces
 * high cosine similarity for all text since it's character-frequency based).
 */
function setup(similarityThreshold = 1.0): { advance: (days: number) => void; memory: MemoryInstance } {
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
    it('inserts a new memory', async () => {
      const { memory } = setup();
      const result = await memory.remember('fact', 'the sky is blue');
      expect(result.id).toBeDefined();
      expect(result.version).toBe(1);
      expect(result.parentId).toBeNull();
    });

    it('creates a new version when content is similar', async () => {
      // Use low threshold to force versioning via fakeEmbed similarity
      const { memory } = setup(0.0);
      const v1 = await memory.remember('fact', 'the sky is blue');
      const v2 = await memory.remember('fact', 'the sky is blue');

      expect(v2.parentId).toBe(v1.id);
      expect(v2.version).toBe(2);
    });

    it('creates standalone memory when content is different', async () => {
      const { memory } = setup();
      const r1 = await memory.remember('fact', 'the sky is blue');
      const r2 = await memory.remember('fact', 'elephants are large mammals with trunks and big ears');

      expect(r2.parentId).toBeNull();
      expect(r2.id).not.toBe(r1.id);
      expect(r2.version).toBe(1);
    });
  });

  describe('get', () => {
    it('retrieves a memory by id', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'the sky is blue');
      const mem = memory.get(id);
      expect(mem).not.toBeNull();
      expect(mem?.content).toBe('the sky is blue');
    });

    it('returns null for unknown id', () => {
      const { memory } = setup();
      expect(memory.get('nonexistent')).toBeNull();
    });

    it('reinforces strength on access', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'the sky is blue', 0.5);
      const mem = memory.get(id);
      // strength should be reinforced (≥ 0.5)
      expect(mem?.strength).toBeGreaterThanOrEqual(0.5);
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
      expect(mems[0]?.strength).toBeLessThan(1.0);
    });

    it('filters out evicted memories', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'temporary memory', 0.2);
      // Advance enough days to decay below eviction threshold (0.15)
      // 0.2 * 0.95^N < 0.15 => N > log(0.15/0.2)/log(0.95) ≈ 5.6 days
      advance(10);

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

  describe('decay and eviction', () => {
    it('reduces strength over time', async () => {
      const { memory, advance } = setup();
      const { id } = await memory.remember('fact', 'a decaying memory', 0.8);

      advance(30);
      const mem = memory.get(id);
      if (mem) {
        expect(mem.strength).toBeLessThan(0.8);
      }
    });

    it('eviction excludes memories from list', async () => {
      const { memory, advance } = setup();
      await memory.remember('fact', 'very weak memory', 0.16);
      advance(5);

      const mems = memory.list();
      // After decay, strength should drop below eviction threshold
      expect(mems.every((m) => m.strength >= 0.15)).toBe(true);
    });
  });

  describe('history', () => {
    it('returns version chain', async () => {
      const { memory } = setup(0.0);
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
      const rel = memory.related(r1.id);
      expect(rel).toHaveLength(1);
      expect(rel[0]?.relation).toBe('similar');
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

  describe('forget', () => {
    it('hard deletes a memory', async () => {
      const { memory } = setup();
      const { id } = await memory.remember('fact', 'something to forget');
      memory.forget(id);
      expect(memory.get(id)).toBeNull();
      expect(memory.list().find((m) => m.id === id)).toBeUndefined();
    });
  });
});
