import BetterSqlite3 from 'better-sqlite3';

import { resolveConfig } from './config.js';
import { createSchema } from './db.js';
import { daysBetween, effectiveStrength, reinforce } from './decay.js';
import { createEmbedder } from './embed.js';
import { createLinks } from './links.js';
import { createSearch } from './search.js';
import { createStore } from './store.js';
import { findSimilar } from './versioning.js';

import type { MemoryConfig } from './config.js';
import type {
  EmbedFunction,
  ListOptions,
  Memory,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
} from './types.js';

interface MemoryInstance {
  forget: (id: string) => void;
  get: (id: string) => Memory | null;
  history: (id: string) => Memory[];
  link: (
    sourceId: string,
    targetId: string,
    relation: string,
    weight?: number,
  ) => void;
  list: (options?: ListOptions) => Memory[];
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
  const db = new BetterSqlite3(config.path);
  createSchema(db);

  const store = createStore(db, config);
  const links = createLinks(db, config);
  const embedder = createEmbedder(config.embed);
  const searcher = createSearch(db, config, store, links, embedder);

  async function remember(
    type: string,
    content: string,
    strength?: number,
  ): Promise<RememberResult> {
    const embedding = await embedder.embed(content);

    // Load all current memories with their vectors
    const vectorRows = db
      .prepare(
        'SELECT mv.memory_id, mv.embedding FROM memory_vectors mv JOIN memories m ON m.id = mv.memory_id WHERE m.current = 1',
      )
      .all() as VectorRow[];

    const candidates = vectorRows.map((row) => ({
      embedding: embedder.fromBlob(row.embedding),
      id: row.memory_id,
      version:
        (
          db
            .prepare('SELECT version FROM memories WHERE id = ?')
            .get(row.memory_id) as { version: number } | undefined
        )?.version ?? 1,
    }));

    const match = findSimilar(
      embedding,
      candidates,
      config.similarityThreshold,
    );

    let result: RememberResult;

    if (match) {
      // Mark old as non-current
      db.prepare('UPDATE memories SET current = 0 WHERE id = ?').run(match.id);

      // Insert new version
      result = store.insert({
        content,
        parentId: match.id,
        strength: strength ?? config.defaultStrength,
        type,
        version: match.version + 1,
      });
    } else {
      result = store.insert({
        content,
        strength: strength ?? config.defaultStrength,
        type,
      });
    }

    // Store embedding
    const blob = embedder.toBlob(embedding);
    db.prepare(
      'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
    ).run(result.id, blob);

    return result;
  }

  function get(id: string): Memory | null {
    const memory = store.get(id);
    if (!memory) return null;

    const now = config.clock();

    if (memory.current) {
      const days = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        days,
        config.decayRate,
      );

      if (effective < config.evictionThreshold) {
        return null;
      }

      const reinforced = reinforce(effective, config.reinforcementBoost);

      // Update DB with reinforced strength and updated timestamp
      db.prepare(
        'UPDATE memories SET strength = ?, updated = ? WHERE id = ?',
      ).run(reinforced, now.toISOString(), id);

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

  return {
    forget,
    get,
    history,
    link,
    list,
    related,
    remember,
    search,
    unlink,
  };
}

export { createMemory };
export type {
  EmbedFunction,
  ListOptions,
  MemoryConfig,
  MemoryInstance,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
};
