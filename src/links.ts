import type Database from 'better-sqlite3';

import type { ResolvedConfig } from './config.js';
import type { MemoryLink, RelatedOptions } from './types.js';

interface LinkRow {
  created: string;
  relation: string;
  source_id: string;
  target_id: string;
  updated: string;
  weight: number;
}

function rowToLink(row: LinkRow): MemoryLink {
  return {
    created: row.created,
    relation: row.relation,
    sourceId: row.source_id,
    targetId: row.target_id,
    updated: row.updated,
    weight: row.weight,
  };
}

interface Links {
  link: (
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ) => void;
  related: (id: string, options?: RelatedOptions) => MemoryLink[];
  unlink: (sourceId: string, targetId: string, relation?: string) => void;
}

function createLinks(db: Database.Database, config: ResolvedConfig): Links {
  function link(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
  ): void {
    const now = config.clock().toISOString();
    db.prepare(
      `
      INSERT INTO memory_links (source_id, target_id, relation, weight, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_id, target_id, relation) DO UPDATE SET
        weight = excluded.weight,
        updated = excluded.updated
    `,
    ).run(sourceId, targetId, relation, weight, now, now);
  }

  function unlink(sourceId: string, targetId: string, relation?: string): void {
    if (relation !== undefined) {
      db.prepare(
        'DELETE FROM memory_links WHERE source_id = ? AND target_id = ? AND relation = ?',
      ).run(sourceId, targetId, relation);
    } else {
      db.prepare(
        'DELETE FROM memory_links WHERE source_id = ? AND target_id = ?',
      ).run(sourceId, targetId);
    }
  }

  function related(id: string, options?: RelatedOptions): MemoryLink[] {
    const conditions: string[] = ['(source_id = ? OR target_id = ?)'];
    const params: unknown[] = [id, id];

    if (options?.relation !== undefined) {
      conditions.push('relation = ?');
      params.push(options.relation);
    }
    if (options?.minWeight !== undefined) {
      conditions.push('weight >= ?');
      params.push(options.minWeight);
    }

    let sql = `SELECT * FROM memory_links WHERE ${conditions.join(' AND ')} ORDER BY weight DESC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as LinkRow[];
    return rows.map(rowToLink);
  }

  return { link, related, unlink };
}

export { createLinks };
export type { Links };
