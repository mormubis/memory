import type Database from 'better-sqlite3';

import { daysBetween, effectiveStrength } from './decay.js';

import type { ResolvedConfig } from './config.js';
import type { Embedder } from './embed.js';
import type { Links } from './links.js';
import type { Store } from './store.js';
import type { SearchOptions, SearchResult } from './types.js';

interface VectorRow {
  embedding: Buffer;
  memory_id: string;
}

interface FtsRow {
  id: string;
  rank: number;
}

interface Search {
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
}

function createSearch(
  db: Database.Database,
  config: ResolvedConfig,
  store: Store,
  links: Links,
  embedder: Embedder,
): Search {
  async function search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    const minStrength = options?.minStrength ?? 0;
    const bm25Weight = options?.weights?.bm25 ?? config.searchWeights.bm25;
    const vectorWeight =
      options?.weights?.vector ?? config.searchWeights.vector;
    const k = config.rrfK;
    const now = config.clock();

    // BM25 stream
    const bm25Ids: string[] = [];
    try {
      let ftsQuery = `SELECT m.id, f.rank FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? AND m.current = 1`;
      const ftsParams: unknown[] = [query];

      if (options?.type !== undefined) {
        ftsQuery += ' AND m.type = ?';
        ftsParams.push(options.type);
      }

      ftsQuery += ' ORDER BY f.rank LIMIT ?';
      ftsParams.push(limit * 2);

      const ftsRows = db.prepare(ftsQuery).all(...ftsParams) as FtsRow[];
      for (const row of ftsRows) {
        bm25Ids.push(row.id);
      }
    } catch {
      // FTS MATCH failure — skip BM25 stream
    }

    // Vector stream
    const queryEmbedding = await embedder.embed(query);
    let vectorQuery = `SELECT mv.memory_id, mv.embedding FROM memory_vectors mv JOIN memories m ON m.id = mv.memory_id WHERE m.current = 1`;
    const vectorParams: unknown[] = [];

    if (options?.type !== undefined) {
      vectorQuery += ' AND m.type = ?';
      vectorParams.push(options.type);
    }

    const vectorRows = (
      vectorParams.length > 0
        ? db.prepare(vectorQuery).all(...vectorParams)
        : db.prepare(vectorQuery).all()
    ) as VectorRow[];

    const vectorScored: { id: string; similarity: number }[] = [];
    for (const row of vectorRows) {
      const vec = embedder.fromBlob(row.embedding);
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        const ai = queryEmbedding[i] ?? 0;
        const bi = vec[i] ?? 0;
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      const similarity = denom === 0 ? 0 : dot / denom;
      vectorScored.push({ id: row.memory_id, similarity });
    }
    vectorScored.sort((a, b) => b.similarity - a.similarity);
    const vectorIds = vectorScored.slice(0, limit * 2).map((x) => x.id);

    // RRF fusion
    const rrfScores = new Map<string, number>();

    bm25Ids.forEach((id, i) => {
      const prev = rrfScores.get(id) ?? 0;
      rrfScores.set(id, prev + bm25Weight * (1 / (k + i + 1)));
    });

    vectorIds.forEach((id, i) => {
      const prev = rrfScores.get(id) ?? 0;
      rrfScores.set(id, prev + vectorWeight * (1 / (k + i + 1)));
    });

    // Fetch memories, apply decay, filter, multiply by strength
    const primary: SearchResult[] = [];

    for (const [id, rrfScore] of rrfScores.entries()) {
      const memory = store.get(id);
      if (!memory) continue;

      const days = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        days,
        config.decayRate,
      );

      if (effective < config.evictionThreshold) continue;
      if (effective < minStrength) continue;

      primary.push({
        memory: { ...memory, strength: effective },
        score: rrfScore * effective,
      });
    }

    // Link expansion
    const primaryIds = new Set(primary.map((r) => r.memory.id));
    const expanded: SearchResult[] = [];

    for (const result of primary) {
      const relatedLinks = links.related(result.memory.id);
      for (const link of relatedLinks) {
        const linkedId =
          link.sourceId === result.memory.id ? link.targetId : link.sourceId;
        if (primaryIds.has(linkedId)) continue;

        const linkedMemory = store.get(linkedId);
        if (!linkedMemory || !linkedMemory.current) continue;

        const days = daysBetween(new Date(linkedMemory.updated), now);
        const effective = effectiveStrength(
          linkedMemory.strength,
          days,
          config.decayRate,
        );

        if (effective < config.evictionThreshold) continue;
        if (effective < minStrength) continue;

        // Decay link weight based on time since link was updated
        const linkDays = daysBetween(new Date(link.updated), now);
        const decayedWeight = link.weight * config.decayRate ** linkDays;

        const linkScore = decayedWeight * effective * 0.5;
        expanded.push({
          memory: { ...linkedMemory, strength: effective },
          score: linkScore,
        });
        primaryIds.add(linkedId);
      }
    }

    const all = [...primary, ...expanded];
    all.sort((a, b) => b.score - a.score);

    return all.slice(0, limit);
  }

  return { search };
}

export { createSearch };
export type { Search };
