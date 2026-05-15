import type Database from 'better-sqlite3';

import { generateId } from './id.js';

import type { ResolvedConfig } from './config.js';
import type { ListOptions, Memory, RememberResult } from './types.js';

interface InsertInput {
  content: string;
  parentId?: string | null;
  strength?: number;
  type: string;
  version?: number;
}

interface MemoryRow {
  content: string;
  created: string;
  current: number;
  id: string;
  parent_id: string | null;
  strength: number;
  type: string;
  updated: string;
  version: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    content: row.content,
    created: row.created,
    current: row.current === 1,
    id: row.id,
    parentId: row.parent_id,
    strength: row.strength,
    type: row.type,
    updated: row.updated,
    version: row.version,
  };
}

interface Store {
  forget: (id: string) => void;
  get: (id: string) => Memory | null;
  history: (id: string) => Memory[];
  insert: (input: InsertInput) => RememberResult;
  list: (options?: ListOptions) => Memory[];
}

function createStore(db: Database.Database, config: ResolvedConfig): Store {
  function insert(input: InsertInput): RememberResult {
    const id = generateId();
    const now = config.clock().toISOString();
    const strength = input.strength ?? config.defaultStrength;
    const version = input.version ?? 1;
    const parentId = input.parentId ?? null;

    db.prepare(`
      INSERT INTO memories (id, type, content, strength, version, parent_id, current, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.type, input.content, strength, version, parentId, now, now);

    db.prepare(`
      INSERT INTO memories_fts (rowid, content)
      VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)
    `).run(id, input.content);

    return { id, parentId, version };
  }

  function get(id: string): Memory | null {
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  function list(options?: ListOptions): Memory[] {
    const conditions: string[] = ['current = 1'];
    const params: unknown[] = [];

    if (options?.type !== undefined) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options?.minStrength !== undefined) {
      conditions.push('strength >= ?');
      params.push(options.minStrength);
    }
    if (options?.maxStrength !== undefined) {
      conditions.push('strength <= ?');
      params.push(options.maxStrength);
    }

    let sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created DESC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  function forget(id: string): void {
    const row = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
    if (row) {
      db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid);
    }
    db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(id);
    db.prepare('DELETE FROM memory_links WHERE source_id = ? OR target_id = ?').run(id, id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  function history(id: string): Memory[] {
    const result: Memory[] = [];
    let currentId: string | null = id;

    while (currentId) {
      const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(currentId) as MemoryRow | undefined;
      if (!row) break;
      result.push(rowToMemory(row));
      currentId = row.parent_id;
    }

    return result;
  }

  return { forget, get, history, insert, list };
}

export { createStore };
export type { InsertInput, MemoryRow, Store };
