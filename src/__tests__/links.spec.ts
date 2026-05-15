import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../db.js';
import { createLinks } from '../links.js';
import { createStore } from '../store.js';

import type { Links } from '../links.js';

describe('createLinks', () => {
  let db: Database.Database;
  let links: Links;
  let idA: string;
  let idB: string;
  let idC: string;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    const config = resolveConfig();
    const store = createStore(db, config);
    links = createLinks(db, config);

    idA = store.insert({ content: 'memory A', type: 'fact' }).id;
    idB = store.insert({ content: 'memory B', type: 'fact' }).id;
    idC = store.insert({ content: 'memory C', type: 'fact' }).id;
  });

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
