import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createSchema } from '../db.js';

describe('createSchema', () => {
  it('creates the memories table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the memory_vectors table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vectors'").all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the memory_links table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_links'").all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates the FTS5 virtual table', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    createSchema(db);
    createSchema(db);
    const count = db.prepare("SELECT count(*) as c FROM sqlite_master WHERE name='memories'").get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });
});
