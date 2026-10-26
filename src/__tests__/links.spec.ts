import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../database.js';
import { createLinks } from '../links.js';
import { createStore } from '../store.js';

import type { Links } from '../links.js';
import type { Store } from '../store.js';

describe('createLinks', () => {
  let database: Database.Database;
  let links: Links;
  let store: Store;
  let idA: string;
  let idB: string;
  let idC: string;

  beforeEach(() => {
    database = new Database(':memory:');
    createSchema(database);
    const config = resolveConfig();
    store = createStore(database, config);
    links = createLinks(database, config);

    idA = store.insert({ content: 'memory A', type: 'fact' }).id;
    idB = store.insert({ content: 'memory B', type: 'fact' }).id;
    idC = store.insert({ content: 'memory C', type: 'fact' }).id;
  });

  function supersede(id: string): string {
    const newer = store.insert({
      content: 'newer',
      parentId: id,
      type: 'fact',
    });
    database.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(id);
    return newer.id;
  }

  describe('link', () => {
    it('creates a link between two memories', () => {
      links.link(idA, idB, 'related');
      const result = links.related(idA);
      expect(result).toHaveLength(1);
      expect(result[0]?.relation).toBe('related');
    });

    it('reinforces (upserts) on duplicate link', () => {
      links.link(idA, idB, 'related', 0.5);
      links.link(idA, idB, 'related', 0.9);
      const result = links.related(idA);
      expect(result).toHaveLength(1);
      expect(result[0]?.weight).toBe(0.9);
    });

    it('allows multiple different relations between same pair', () => {
      links.link(idA, idB, 'related');
      links.link(idA, idB, 'contradicts');
      const result = links.related(idA);
      expect(result).toHaveLength(2);
    });

    it('throws when sourceId does not exist', () => {
      expect(() => links.link('nonexistent', idB, 'related')).toThrow(
        'sourceId "nonexistent" does not exist',
      );
    });

    it('throws when targetId does not exist', () => {
      expect(() => links.link(idA, 'nonexistent', 'related')).toThrow(
        'targetId "nonexistent" does not exist',
      );
    });

    it('throws when both IDs do not exist', () => {
      expect(() => links.link('bad-source', 'bad-target', 'related')).toThrow(
        'sourceId "bad-source" does not exist',
      );
    });

    it('does not insert a link when validation fails', () => {
      try {
        links.link('nonexistent', idB, 'related');
      } catch {
        // expected
      }
      const rows = database
        .prepare('SELECT COUNT(*) as count FROM memory_links')
        .get() as { count: number };
      expect(rows.count).toBe(0);
    });
  });

  describe('link with superseded IDs', () => {
    it('links the current version of a superseded source', () => {
      const a2 = supersede(idA);
      links.link(idA, idB, 'related');
      expect(links.related(a2)[0]?.sourceId).toBe(a2);
      expect(links.related(idA)).toHaveLength(0);
    });

    it('links the current version of a superseded target', () => {
      const b2 = supersede(idB);
      links.link(idA, idB, 'related');
      expect(links.related(b2)[0]?.targetId).toBe(b2);
    });

    it('follows several versions', () => {
      const a3 = supersede(supersede(idA));
      links.link(idA, idB, 'related');
      expect(links.related(a3)).toHaveLength(1);
    });

    it('does nothing when both IDs resolve to the same memory', () => {
      const a2 = supersede(idA);
      expect(() => links.link(idA, a2, 'related')).not.toThrow();
      const rows = database
        .prepare('SELECT COUNT(*) as count FROM memory_links')
        .get() as { count: number };
      expect(rows.count).toBe(0);
    });

    it('links the last existing version when the newer one is gone', () => {
      database.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(idA);
      links.link(idA, idB, 'related');
      expect(links.related(idA)).toHaveLength(1);
    });

    it('stops on a parent cycle', () => {
      const setParent = database.prepare(
        'UPDATE memories SET parent_id = ?, current = 0 WHERE id = ?',
      );
      setParent.run(idB, idA);
      setParent.run(idA, idB);
      links.link(idA, idC, 'related');
      expect(links.related(idC)).toHaveLength(1);
    });
  });

  describe('unlink', () => {
    it('removes a specific relation', () => {
      links.link(idA, idB, 'related');
      links.link(idA, idB, 'contradicts');
      links.unlink(idA, idB, 'related');
      const result = links.related(idA);
      expect(result).toHaveLength(1);
      expect(result[0]?.relation).toBe('contradicts');
    });

    it('removes all links between a pair when relation is omitted', () => {
      links.link(idA, idB, 'related');
      links.link(idA, idB, 'contradicts');
      links.unlink(idA, idB);
      expect(links.related(idA)).toHaveLength(0);
    });
  });

  describe('related', () => {
    it('returns links in both directions', () => {
      links.link(idA, idB, 'related');
      const fromA = links.related(idA);
      const fromB = links.related(idB);
      expect(fromA).toHaveLength(1);
      expect(fromB).toHaveLength(1);
    });

    it('filters by relation', () => {
      links.link(idA, idB, 'related');
      links.link(idA, idC, 'contradicts');
      const result = links.related(idA, { relation: 'related' });
      expect(result).toHaveLength(1);
      expect(result[0]?.targetId).toBe(idB);
    });

    it('orders by weight descending', () => {
      links.link(idA, idB, 'related', 0.3);
      links.link(idA, idC, 'related', 0.9);
      const result = links.related(idA);
      expect(result[0]?.weight).toBe(0.9);
      expect(result[1]?.weight).toBe(0.3);
    });

    it('respects limit', () => {
      links.link(idA, idB, 'related');
      links.link(idA, idC, 'related');
      const result = links.related(idA, { limit: 1 });
      expect(result).toHaveLength(1);
    });
  });
});
