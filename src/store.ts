import { generateId } from './id.js';

import type { ResolvedConfig } from './config.js';
import type { ListOptions, Memory, RememberResult } from './types.js';
import type Database from 'better-sqlite3';

interface InsertInput {
  content: string;
  parentId?: string | undefined;
  strength?: number;
  type: string;
  version?: number;
}

interface MemoryRow {
  content: string;
  created: string;
  current: number;
  id: string;
  parent_id: string | undefined;
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
  get: (id: string) => Memory | undefined;
  history: (id: string) => Memory[];
  insert: (input: InsertInput) => RememberResult;
  list: (options?: ListOptions) => Memory[];
}

function createStore(
  database: Database.Database,
  config: ResolvedConfig,
): Store {
  function insert(input: InsertInput): RememberResult {
    const id = generateId();
    const now = config.clock().toISOString();
    const strength = input.strength ?? config.defaultStrength;
    const version = input.version ?? 1;
    const parentId = input.parentId ?? undefined;

    database
      .prepare(
        `
      INSERT INTO memories (id, type, content, strength, version, parent_id, current, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
      )
      .run(
        id,
        input.type,
        input.content,
        strength,
        version,
        parentId,
        now,
        now,
      );

    database
      .prepare(
        `
      INSERT INTO memories_fts (rowid, content)
      VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)
    `,
      )
      .run(id, input.content);

    return { id, parentId, version };
  }

  function get(id: string): Memory | undefined {
    const row = database
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  function list(options?: ListOptions): Memory[] {
    const conditions: string[] = ['current = 1'];
    const parameters: unknown[] = [];

    if (options?.type !== undefined) {
      conditions.push('type = ?');
      parameters.push(options.type);
    }
    if (options?.minStrength !== undefined) {
      conditions.push('strength >= ?');
      parameters.push(options.minStrength);
    }
    if (options?.maxStrength !== undefined) {
      conditions.push('strength <= ?');
      parameters.push(options.maxStrength);
    }

    let sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created DESC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      parameters.push(options.limit);
    }

    const rows = database.prepare(sql).all(...parameters) as MemoryRow[];
    return rows.map((row) => rowToMemory(row));
  }

  function forget(id: string): void {
    const row = database
      .prepare('SELECT rowid FROM memories WHERE id = ?')
      .get(id) as { rowid: number } | undefined;
    if (row) {
      database
        .prepare('DELETE FROM memories_fts WHERE rowid = ?')
        .run(row.rowid);
    }
    database.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(id);
    database
      .prepare('DELETE FROM memory_links WHERE source_id = ? OR target_id = ?')
      .run(id, id);
    database.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  function history(id: string): Memory[] {
    const result: Memory[] = [];
    let currentId: string | undefined = id;

    while (currentId) {
      const row = database
        .prepare('SELECT * FROM memories WHERE id = ?')
        .get(currentId) as MemoryRow | undefined;
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
