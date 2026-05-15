import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../db.js';
import { createEmbedder } from '../embed.js';
import { createLinks } from '../links.js';
import { createSearch } from '../search.js';
import { createStore } from '../store.js';

import type { Embedder } from '../embed.js';
import type { Links } from '../links.js';
import type { Search } from '../search.js';
import type { Store } from '../store.js';

async function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 8] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  return vec.map((v: number) => v / (norm || 1));
}

async function insertWithVector(
  store: Store,
  embedder: Embedder,
  db: Database.Database,
  input: { content: string; type: string; strength?: number },
) {
  const result = store.insert(input);
  const vector = await embedder.embed(input.content);
  const blob = embedder.toBlob(vector);
  db.prepare(
    'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
  ).run(result.id, blob);
  return result;
}

describe('createSearch', () => {
  let db: Database.Database;
  let store: Store;
  let links: Links;
  let embedder: Embedder;
  let searcher: Search;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    const config = resolveConfig({ embed: fakeEmbed });
    store = createStore(db, config);
    links = createLinks(db, config);
    embedder = createEmbedder(fakeEmbed);
    searcher = createSearch(db, config, store, links, embedder);
  });

  describe('search', () => {
    it('returns BM25 matches for relevant content', async () => {
      await insertWithVector(store, embedder, db, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      await insertWithVector(store, embedder, db, {
        content: 'completely unrelated text about cats',
        type: 'fact',
      });

      const results = await searcher.search('fox');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.memory.content).toContain('fox');
    });

    it('filters results by type', async () => {
      await insertWithVector(store, embedder, db, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      await insertWithVector(store, embedder, db, {
        content: 'the quick brown fox jumps',
        type: 'event',
      });

      const results = await searcher.search('fox', { type: 'fact' });
      expect(results.every((r) => r.memory.type === 'fact')).toBe(true);
    });

    it('respects the limit option', async () => {
      await insertWithVector(store, embedder, db, {
        content: 'memory about dogs',
        type: 'fact',
      });
      await insertWithVector(store, embedder, db, {
        content: 'memory about cats',
        type: 'fact',
      });
      await insertWithVector(store, embedder, db, {
        content: 'memory about birds',
        type: 'fact',
      });

      const results = await searcher.search('memory', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('excludes non-current memories', async () => {
      const result = await insertWithVector(store, embedder, db, {
        content: 'the quick brown fox',
        type: 'fact',
      });
      // Mark as non-current
      db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(result.id);

      const results = await searcher.search('fox');
      expect(results.find((r) => r.memory.id === result.id)).toBeUndefined();
    });

    it('returns scores for results', async () => {
      await insertWithVector(store, embedder, db, {
        content: 'hello world',
        type: 'fact',
      });

      const results = await searcher.search('hello');
      if (results.length > 0) {
        expect(results[0]?.score).toBeGreaterThan(0);
      }
    });
  });
});
