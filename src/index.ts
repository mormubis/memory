import BetterSqlite3 from 'better-sqlite3';

import { resolveConfig } from './config.js';
import { createSchema } from './database.js';
import { daysBetween, effectiveStrength, reinforce } from './decay.js';
import { createEmbedder } from './embed.js';
import { createLinks } from './links.js';
import { createSearch } from './search.js';
import { createStore } from './store.js';
import { findSimilar } from './versioning.js';

import type { MemoryConfig } from './config.js';
import type {
  ListOptions,
  Memory,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
} from './types.js';

interface MemoryInstance {
  deleteVectors: (ids: string[]) => void;
  forget: (id: string) => void;
  get: (id: string) => Memory | undefined;
  history: (id: string) => Memory[];
  link: (
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ) => void;
  list: (options?: ListOptions) => Memory[];
  reindex: () => Promise<number>;
  related: (id: string, options?: RelatedOptions) => MemoryLink[];
  remember: (
    type: string,
    content: string,
    strength?: number,
  ) => Promise<RememberResult>;
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  unlink: (sourceId: string, targetId: string, relation?: string) => void;
}

interface VectorRow {
  embedding: Buffer;
  memory_id: string;
}

function createMemory(input?: MemoryConfig): MemoryInstance {
  const config = resolveConfig(input);
  const database = new BetterSqlite3(config.path);
  createSchema(database);

  const store = createStore(database, config);
  const links = createLinks(database, config);
  const embedder = createEmbedder(config.embed);
  const searcher = createSearch(database, config, store, links, embedder);

  async function remember(
    type: string,
    content: string,
    strength?: number,
  ): Promise<RememberResult> {
    const embedding = await embedder.embed(content);

    // Load all current memories with their vectors
    const vectorRows = database
      .prepare(
        'SELECT mv.memory_id, mv.embedding FROM memory_vectors mv JOIN memories m ON m.id = mv.memory_id WHERE m.current = 1',
      )
      .all() as VectorRow[];

    const candidates = vectorRows.map((row) => ({
      embedding: embedder.fromBlob(row.embedding),
      id: row.memory_id,
      version:
        (
          database
            .prepare('SELECT version FROM memories WHERE id = ?')
            .get(row.memory_id) as { version: number } | undefined
        )?.version ?? 1,
    }));

    const match = findSimilar(
      embedding,
      candidates,
      config.similarityThreshold,
    );

    const resolvedStrength =
      strength ?? config.typeStrength[type] ?? config.defaultStrength;

    let result: RememberResult;

    if (match) {
      // Fetch previous version's stored strength and updated timestamp
      const previous = database
        .prepare('SELECT strength, updated FROM memories WHERE id = ?')
        .get(match.id) as { strength: number; updated: string } | undefined;

      const now = config.clock();
      const previousStrength = previous?.strength ?? resolvedStrength;
      const previousUpdated = previous ? new Date(previous.updated) : now;
      const previousEffective = effectiveStrength(
        previousStrength,
        daysBetween(previousUpdated, now),
        config.decayRate,
      );
      const boostedStrength = Math.min(
        1,
        previousEffective + config.reinforcementBoost,
      );
      const finalStrength = Math.max(resolvedStrength, boostedStrength);

      // Mark old as non-current
      database
        .prepare('UPDATE memories SET current = 0 WHERE id = ?')
        .run(match.id);

      // Insert new version with auto-boosted strength
      result = store.insert({
        content,
        parentId: match.id,
        strength: finalStrength,
        type,
        version: match.version + 1,
      });

      // Migrate links from old memory to new version
      const nowIso = now.toISOString();
      database
        .prepare(
          `UPDATE OR REPLACE memory_links SET source_id = ?, updated = ? WHERE source_id = ?`,
        )
        .run(result.id, nowIso, match.id);
      database
        .prepare(
          `UPDATE OR REPLACE memory_links SET target_id = ?, updated = ? WHERE target_id = ?`,
        )
        .run(result.id, nowIso, match.id);
    } else {
      result = store.insert({
        content,
        strength: resolvedStrength,
        type,
      });
    }

    // Store embedding
    const blob = embedder.toBlob(embedding);
    database
      .prepare(
        'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
      )
      .run(result.id, blob);

    return result;
  }

  function get(id: string): Memory | undefined {
    const memory = store.get(id);
    if (!memory) return undefined;

    const now = config.clock();

    if (memory.current) {
      const days = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        days,
        config.decayRate,
      );

      if (effective < config.evictionThreshold) {
        return undefined;
      }

      const reinforced = reinforce(effective, config.reinforcementBoost);

      // Update DB with reinforced strength and updated timestamp
      database
        .prepare('UPDATE memories SET strength = ?, updated = ? WHERE id = ?')
        .run(reinforced, now.toISOString(), id);

      return { ...memory, strength: reinforced };
    }

    return memory;
  }

  function list(options?: ListOptions): Memory[] {
    const memories = store.list(options);
    const now = config.clock();
    const result: Memory[] = [];

    for (const memory of memories) {
      const days = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        days,
        config.decayRate,
      );

      if (effective < config.evictionThreshold) continue;
      if (options?.minStrength !== undefined && effective < options.minStrength)
        continue;

      result.push({ ...memory, strength: effective });
    }

    return result;
  }

  function forget(id: string): void {
    store.forget(id);
  }

  function history(id: string): Memory[] {
    return store.history(id);
  }

  function link(
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ): void {
    links.link(sourceId, targetId, relation, weight);
  }

  function unlink(sourceId: string, targetId: string, relation?: string): void {
    links.unlink(sourceId, targetId, relation);
  }

  function related(id: string, options?: RelatedOptions): MemoryLink[] {
    return links.related(id, options);
  }

  function search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    return searcher.search(query, options);
  }

  async function reindex(): Promise<number> {
    const orphans = database
      .prepare(
        `SELECT id, content FROM memories
         WHERE current = 1
         AND id NOT IN (SELECT memory_id FROM memory_vectors)`,
      )
      .all() as { content: string; id: string }[];

    for (const orphan of orphans) {
      const embedding = await embedder.embed(orphan.content);
      const blob = embedder.toBlob(embedding);
      database
        .prepare(
          'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
        )
        .run(orphan.id, blob);
    }

    return orphans.length;
  }

  function deleteVectors(ids: string[]): void {
    const stmt = database.prepare(
      'DELETE FROM memory_vectors WHERE memory_id = ?',
    );
    for (const id of ids) {
      stmt.run(id);
    }
  }

  return {
    deleteVectors,
    forget,
    get,
    history,
    link,
    list,
    reindex,
    related,
    remember,
    search,
    unlink,
  };
}

export { createMemory };
export type { MemoryInstance };

export {
  type EmbedFunction,
  type ListOptions,
  type Memory,
  type MemoryLink,
  type RelatedOptions,
  type RememberResult,
  type SearchOptions,
  type SearchResult,
} from './types.js';
export { type MemoryConfig } from './config.js';
