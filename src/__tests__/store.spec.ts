import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../config.js';
import { createSchema } from '../database.js';
import { effectiveStrength } from '../decay.js';
import { createStore } from '../store.js';

import type { Store } from '../store.js';

describe('createStore', () => {
  let database: Database.Database;
  let store: Store;

  beforeEach(() => {
    database = new Database(':memory:');
    createSchema(database);
    store = createStore(database, resolveConfig());
  });

  describe('insert', () => {
    it('returns id, version, parentId', () => {
      const result = store.insert({ content: 'hello', type: 'fact' });
      expect(result.id).toBeDefined();
      expect(result.version).toBe(1);
      expect(result.parentId).toBeUndefined();
    });

    it('uses default strength from config', () => {
      const result = store.insert({ content: 'hello', type: 'fact' });
      const mem = store.get(result.id);
      expect(mem?.strength).toBe(0.2);
    });

    it('accepts explicit strength', () => {
      const result = store.insert({
        content: 'hello',
        type: 'fact',
        strength: 0.8,
      });
      const mem = store.get(result.id);
      expect(mem?.strength).toBe(0.8);
    });

    it('stores parentId', () => {
      const parent = store.insert({ content: 'parent', type: 'fact' });
      const child = store.insert({
        content: 'child',
        type: 'fact',
        parentId: parent.id,
        version: 2,
      });
      expect(child.parentId).toBe(parent.id);
      expect(child.version).toBe(2);
    });
  });

  describe('get', () => {
    it('returns memory by id', () => {
      const { id } = store.insert({ content: 'test content', type: 'note' });
      const mem = store.get(id);
      expect(mem).toBeDefined();
      expect(mem?.content).toBe('test content');
      expect(mem?.type).toBe('note');
      expect(mem?.current).toBe(true);
    });

    it('returns undefined for unknown id', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns only current memories', () => {
      store.insert({ content: 'current', type: 'fact' });
      // manually insert a non-current row
      database
        .prepare(
          `INSERT INTO memories (id, type, content, strength, version, parent_id, current, created, updated)
         VALUES ('old', 'fact', 'old content', 0.5, 1, NULL, 0, datetime('now'), datetime('now'))`,
        )
        .run();

      const results = store.list();
      expect(results.every((m) => m.current === true)).toBe(true);
      expect(results.some((m) => m.content === 'old content')).toBe(false);
    });

    it('filters by type', () => {
      store.insert({ content: 'a fact', type: 'fact' });
      store.insert({ content: 'an event', type: 'event' });
      const facts = store.list({ type: 'fact' });
      expect(facts).toHaveLength(1);
      expect(facts[0]?.type).toBe('fact');
    });

    it('respects limit', () => {
      store.insert({ content: 'first', type: 'fact' });
      store.insert({ content: 'second', type: 'fact' });
      store.insert({ content: 'third', type: 'fact' });
      const results = store.list({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('filters by minStrength', () => {
      store.insert({ content: 'weak', type: 'fact', strength: 0.2 });
      store.insert({ content: 'strong', type: 'fact', strength: 0.8 });
      const results = store.list({ minStrength: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('strong');
    });

    it('filters by maxStrength', () => {
      store.insert({ content: 'weak', type: 'fact', strength: 0.2 });
      store.insert({ content: 'strong', type: 'fact', strength: 0.8 });
      const results = store.list({ maxStrength: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('weak');
    });

    describe('decay', () => {
      it('applies Ebbinghaus decay to returned memories', () => {
        const t0 = new Date('2024-01-01T00:00:00Z');
        const t30 = new Date('2024-01-31T00:00:00Z');
        let now = t0;

        const database_ = new Database(':memory:');
        createSchema(database_);
        const config = resolveConfig({ clock: () => now, decayRate: 0.99 });
        const timeStore = createStore(database_, config);

        timeStore.insert({ content: 'test', type: 'fact', strength: 0.8 });

        now = t30;
        const results = timeStore.list();

        expect(results[0]?.strength).toBeCloseTo(
          effectiveStrength(0.8, 30, 0.99),
          5,
        );
      });

      it('writes decayed strength back to the database', () => {
        const t0 = new Date('2024-01-01T00:00:00Z');
        const t30 = new Date('2024-01-31T00:00:00Z');
        let now = t0;

        const database_ = new Database(':memory:');
        createSchema(database_);
        const config = resolveConfig({ clock: () => now, decayRate: 0.99 });
        const timeStore = createStore(database_, config);

        const { id } = timeStore.insert({
          content: 'test',
          type: 'fact',
          strength: 0.8,
        });

        now = t30;
        timeStore.list();

        const row = database_
          .prepare('SELECT strength FROM memories WHERE id = ?')
          .get(id) as { strength: number };
        expect(row.strength).toBeCloseTo(effectiveStrength(0.8, 30, 0.99), 5);
      });

      it('minStrength filter uses effective strength, not stored', () => {
        const t0 = new Date('2024-01-01T00:00:00Z');
        const t30 = new Date('2024-01-31T00:00:00Z');
        let now = t0;

        const database_ = new Database(':memory:');
        createSchema(database_);
        // stored=0.5, after 30 days at 0.99: 0.5*0.99^30 ≈ 0.370
        const config = resolveConfig({ clock: () => now, decayRate: 0.99 });
        const timeStore = createStore(database_, config);

        timeStore.insert({ content: 'test', type: 'fact', strength: 0.5 });

        now = t30;
        // effective ≈ 0.370 < 0.4, so should be excluded
        const results = timeStore.list({ minStrength: 0.4 });
        expect(results).toHaveLength(0);
      });

      it('maxStrength filter uses effective strength, not stored', () => {
        const t0 = new Date('2024-01-01T00:00:00Z');
        const t30 = new Date('2024-01-31T00:00:00Z');
        let now = t0;

        const database_ = new Database(':memory:');
        createSchema(database_);
        // stored=0.5 > maxStrength=0.4, but after 30 days: 0.5*0.99^30 ≈ 0.370 < 0.4
        const config = resolveConfig({ clock: () => now, decayRate: 0.99 });
        const timeStore = createStore(database_, config);

        timeStore.insert({ content: 'test', type: 'fact', strength: 0.5 });

        now = t30;
        // effective ≈ 0.370 < 0.4, so should now pass maxStrength
        const results = timeStore.list({ maxStrength: 0.4 });
        expect(results).toHaveLength(1);
      });
    });
  });

  describe('forget', () => {
    it('hard deletes the memory', () => {
      const { id } = store.insert({ content: 'to forget', type: 'fact' });
      store.forget(id);
      expect(store.get(id)).toBeUndefined();
    });

    it('cleans up FTS index', () => {
      const { id } = store.insert({ content: 'searchable text', type: 'fact' });
      const rowBefore = database
        .prepare('SELECT rowid FROM memories WHERE id = ?')
        .get(id) as { rowid: number } | undefined;
      store.forget(id);
      // memory is gone, so use saved rowid to check FTS
      expect(rowBefore).toBeDefined();
      const ftsRow = database
        .prepare('SELECT rowid FROM memories_fts WHERE rowid = ?')
        .get(rowBefore!.rowid);
      expect(ftsRow).toBeUndefined();
    });
  });

  describe('history', () => {
    it('returns v1 memory as single-item history', () => {
      const { id } = store.insert({ content: 'original', type: 'fact' });
      const hist = store.history(id);
      expect(hist).toHaveLength(1);
      expect(hist[0]?.content).toBe('original');
    });

    it('walks parent chain for versioned memories', () => {
      const v1 = store.insert({ content: 'v1 content', type: 'fact' });
      const v2 = store.insert({
        content: 'v2 content',
        type: 'fact',
        parentId: v1.id,
        version: 2,
      });
      const hist = store.history(v2.id);
      expect(hist).toHaveLength(2);
      expect(hist[0]?.content).toBe('v2 content');
      expect(hist[1]?.content).toBe('v1 content');
    });

    it('returns empty for nonexistent id', () => {
      expect(store.history('nonexistent')).toHaveLength(0);
    });
  });
});
