import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createSchema } from '../database.js';

describe('createSchema', () => {
  it('creates the memories table', () => {
    const database = new Database(':memory:');
    createSchema(database);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'",
      )
      .all();
    expect(tables).toHaveLength(1);
    database.close();
  });

  it('creates the memory_vectors table', () => {
    const database = new Database(':memory:');
    createSchema(database);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vectors'",
      )
      .all();
    expect(tables).toHaveLength(1);
    database.close();
  });

  it('creates the memory_links table', () => {
    const database = new Database(':memory:');
    createSchema(database);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_links'",
      )
      .all();
    expect(tables).toHaveLength(1);
    database.close();
  });

  it('creates the FTS5 virtual table', () => {
    const database = new Database(':memory:');
    createSchema(database);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'",
      )
      .all();
    expect(tables).toHaveLength(1);
    database.close();
  });

  it('is idempotent', () => {
    const database = new Database(':memory:');
    createSchema(database);
    createSchema(database);
    const count = database
      .prepare("SELECT count(*) as c FROM sqlite_master WHERE name='memories'")
      .get() as { c: number };
    expect(count.c).toBe(1);
    database.close();
  });
});
