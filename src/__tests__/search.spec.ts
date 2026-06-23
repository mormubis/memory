import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../database.js';
import { createEmbedder } from '../embed.js';
import { createLinks } from '../links.js';
import { createSearch } from '../search.js';
import { createStore } from '../store.js';

import type { Embedder } from '../embed.js';
import type { Links } from '../links.js';
import type { Search } from '../search.js';
import type { Store } from '../store.js';

async function fakeEmbed(text: string): Promise<number[]> {
  const vec = Array.from<number>({ length: 8 }).fill(0);
  for (let index = 0; index < text.length; index++) {
    vec[index % 8]! += (text.codePointAt(index) ?? 0) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  return vec.map((v: number) => v / (norm || 1));
}

async function insertWithVector(
  store: Store,
  embedder: Embedder,
  database: Database.Database,
  input: { content: string; type: string; strength?: number },
) {
  const result = store.insert(input);
  const vector = await embedder.embed(input.content);
  const blob = embedder.toBlob(vector);
  database
    .prepare('INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)')
    .run(result.id, blob);
  return result;
}

describe('createSearch', () => {
  let database: Database.Database;
  let store: Store;
  let links: Links;
  let embedder: Embedder;
  let searcher: Search;

  beforeEach(() => {
    database = new Database(':memory:');
    createSchema(database);
    const config = resolveConfig({ embed: fakeEmbed });
    store = createStore(database, config);
    links = createLinks(database, config);
    embedder = createEmbedder(fakeEmbed);
    searcher = createSearch(database, config, store, links, embedder);
  });

  describe('search', () => {
    it('returns BM25 matches for relevant content', async () => {
      await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      await insertWithVector(store, embedder, database, {
        content: 'completely unrelated text about cats',
        type: 'fact',
      });

      const results = await searcher.search('fox');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.memory.content).toContain('fox');
    });

    it('filters results by type', async () => {
      await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox jumps',
        type: 'event',
      });

      const results = await searcher.search('fox', { type: 'fact' });
      expect(results.every((r) => r.memory.type === 'fact')).toBe(true);
    });

    it('respects the limit option', async () => {
      await insertWithVector(store, embedder, database, {
        content: 'memory about dogs',
        type: 'fact',
      });
      await insertWithVector(store, embedder, database, {
        content: 'memory about cats',
        type: 'fact',
      });
      await insertWithVector(store, embedder, database, {
        content: 'memory about birds',
        type: 'fact',
      });

      const results = await searcher.search('memory', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('excludes non-current memories', async () => {
      const result = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      // Mark as non-current
      database
        .prepare('UPDATE memories SET current = 0 WHERE id = ?')
        .run(result.id);

      const results = await searcher.search('fox');
      expect(results.find((r) => r.memory.id === result.id)).toBeUndefined();
    });

    it('returns scores for results', async () => {
      await insertWithVector(store, embedder, database, {
        content: 'hello world',
        type: 'fact',
      });

      const results = await searcher.search('hello');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    it('marks link-expanded results with expanded: true', async () => {
      const a = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      // b has a different type so it won't appear in a type-filtered primary search,
      // but will appear via link expansion (which does not filter by type)
      const b = await insertWithVector(store, embedder, database, {
        content: 'completely unrelated content',
        type: 'note',
      });
      links.link(a.id, b.id, 'related', 0.6);

      const results = await searcher.search('fox', { limit: 5, type: 'fact' });
      const direct = results.find((r) => r.memory.id === a.id);
      const expanded = results.find((r) => r.memory.id === b.id);

      expect(direct?.expanded).toBe(false);
      expect(expanded?.expanded).toBe(true);
    });

    it('link-expanded result scores no higher than its source direct match', async () => {
      const source = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      const linked = await insertWithVector(store, embedder, database, {
        content: 'completely unrelated content',
        type: 'note',
      });
      links.link(source.id, linked.id, 'related', 1);

      const results = await searcher.search('fox', { limit: 5, type: 'fact' });
      // type:'fact' filters primary pool — 'note' can only appear via link expansion
      // IMPORTANT: the type option filters primary search but link expansion ignores it
      // Read the code: options?.type is applied to FTS and vector queries but NOT to linkedMemory fetches
      const sourceResult = results.find((r) => r.memory.id === source.id);
      const linkedResult = results.find((r) => r.memory.id === linked.id);

      expect(sourceResult).toBeDefined();
      expect(linkedResult).toBeDefined();
      expect(linkedResult!.score).toBeLessThanOrEqual(sourceResult!.score);
    });

    it('direct match receives full proportional boost', async () => {
      const config = resolveConfig({ embed: fakeEmbed });
      const memory = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      const initialStrength = store.get(memory.id)!.strength;

      const results = await searcher.search('fox', { limit: 5 });
      const result = results.find((r) => r.memory.id === memory.id)!;

      // maxScore is the top result's score; for a single result it equals result.score
      const maxScore = results[0]!.score;
      const effectiveBoost =
        config.reinforcementBoost * (result.score / maxScore);
      const expectedStrength = Math.min(
        1,
        initialStrength + effectiveBoost * (1 - initialStrength),
      );

      const updated = store.get(memory.id)!;
      expect(updated.strength).toBeCloseTo(expectedStrength, 6);
    });

    it('link-expanded result receives hub-dampened boost', async () => {
      const config = resolveConfig({ embed: fakeEmbed });
      const source = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      const linked = await insertWithVector(store, embedder, database, {
        content: 'unrelated linked memory',
        type: 'note',
      });
      links.link(source.id, linked.id, 'related', 0.6);
      const initialStrength = store.get(linked.id)!.strength;

      const results = await searcher.search('fox', { limit: 5, type: 'fact' });
      const linkedResult = results.find((r) => r.memory.id === linked.id)!;
      const maxScore = results[0]!.score;

      // linked has 1 link (to source), so linkCount = 1
      const linkCount = Math.max(1, links.related(linked.id).length);
      const effectiveBoost =
        config.reinforcementBoost *
        (linkedResult.score / maxScore) *
        (1 / linkCount);
      const expectedStrength = Math.min(
        1,
        initialStrength + effectiveBoost * (1 - initialStrength),
      );

      const updated = store.get(linked.id)!;
      expect(updated.strength).toBeCloseTo(expectedStrength, 6);
    });

    it('hub memory receives less boost than targeted memory', async () => {
      const source = await insertWithVector(store, embedder, database, {
        content: 'the quick brown fox',
        type: 'fact',
      });

      // hub: linked to source + 10 others (type 'note' to stay out of primary pool)
      const hub = await insertWithVector(store, embedder, database, {
        content: 'unrelated hub memory',
        type: 'note',
      });
      links.link(source.id, hub.id, 'related', 1);
      for (let index = 0; index < 10; index++) {
        const other = store.insert({
          content: `other memory ${index}`,
          type: 'fact',
        });
        links.link(hub.id, other.id, 'related', 0.5);
      }

      // targeted: linked to source only (type 'note' to stay out of primary pool)
      const targeted = await insertWithVector(store, embedder, database, {
        content: 'unrelated targeted memory',
        type: 'note',
      });
      links.link(source.id, targeted.id, 'related', 1);

      const hubInitial = store.get(hub.id)!.strength;
      const targetedInitial = store.get(targeted.id)!.strength;

      await searcher.search('fox', { limit: 10, type: 'fact' });

      const hubStrengthDelta = store.get(hub.id)!.strength - hubInitial;
      const targetedStrengthDelta =
        store.get(targeted.id)!.strength - targetedInitial;

      // hub has 11 links vs targeted's 1 — hub receives less boost per appearance
      expect(targetedStrengthDelta).toBeGreaterThan(hubStrengthDelta);
    });
  });
});
