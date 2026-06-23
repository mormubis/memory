import { daysBetween, effectiveStrength, reinforce } from './decay.js';

import type { ResolvedConfig } from './config.js';
import type { Embedder } from './embed.js';
import type { Links } from './links.js';
import type { Store } from './store.js';
import type { SearchOptions, SearchResult } from './types.js';
import type Database from 'better-sqlite3';

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
  database: Database.Database,
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
    const k = config.rrfK;
    const now = config.clock();

    // --- BM25 stream ---
    const bm25Ids: string[] = [];
    try {
      let ftsQuery = `SELECT m.id, f.rank FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? AND m.current = 1`;
      const ftsParameters: unknown[] = [query];

      if (options?.type !== undefined) {
        ftsQuery += ' AND m.type = ?';
        ftsParameters.push(options.type);
      }

      ftsQuery += ' ORDER BY f.rank LIMIT ?';
      ftsParameters.push(limit * 2);

      const ftsRows = database
        .prepare(ftsQuery)
        .all(...ftsParameters) as FtsRow[];
      for (const row of ftsRows) {
        bm25Ids.push(row.id);
      }
    } catch {
      // FTS MATCH failure — skip BM25 stream
    }

    // --- Vector stream ---
    const queryEmbedding = await embedder.embed(query);
    let vectorQuery = `SELECT mv.memory_id, mv.embedding FROM memory_vectors mv JOIN memories m ON m.id = mv.memory_id WHERE m.current = 1`;
    const vectorParameters: unknown[] = [];

    if (options?.type !== undefined) {
      vectorQuery += ' AND m.type = ?';
      vectorParameters.push(options.type);
    }

    const vectorRows = (
      vectorParameters.length > 0
        ? database.prepare(vectorQuery).all(...vectorParameters)
        : database.prepare(vectorQuery).all()
    ) as VectorRow[];

    const vectorScored: { id: string; similarity: number }[] = [];
    for (const row of vectorRows) {
      const vec = embedder.fromBlob(row.embedding);
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (const [index, element] of queryEmbedding.entries()) {
        const ai = element ?? 0;
        const bi = vec[index] ?? 0;
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

    // --- Weight normalization ---
    // If a stream returned no results, redistribute its weight
    const hasBm25 = bm25Ids.length > 0;
    const hasVector = vectorIds.length > 0;

    let bm25Weight = options?.weights?.bm25 ?? config.searchWeights.bm25;
    let vectorWeight = options?.weights?.vector ?? config.searchWeights.vector;

    if (!hasBm25 && !hasVector) {
      // nothing to fuse
      bm25Weight = 0;
      vectorWeight = 0;
    } else if (!hasBm25) {
      vectorWeight = 1;
      bm25Weight = 0;
    } else if (hasVector) {
      const total = bm25Weight + vectorWeight;
      if (total > 0) {
        bm25Weight /= total;
        vectorWeight /= total;
      }
    } else {
      bm25Weight = 1;
      vectorWeight = 0;
    }

    // --- RRF fusion (pure relevance, no strength multiplier) ---
    const rrfScores = new Map<string, number>();

    for (const [index, id] of bm25Ids.entries()) {
      const previous = rrfScores.get(id) ?? 0;
      rrfScores.set(id, previous + bm25Weight * (1 / (k + index + 1)));
    }

    for (const [index, id] of vectorIds.entries()) {
      const previous = rrfScores.get(id) ?? 0;
      rrfScores.set(id, previous + vectorWeight * (1 / (k + index + 1)));
    }

    // --- Fetch memories, apply decay filter (but don't use strength in score) ---
    const primary: SearchResult[] = [];

    for (const [id, rrfScore] of rrfScores.entries()) {
      const memory = store.get(id);
      if (!memory) {
        continue;
      }

      const days = daysBetween(new Date(memory.updated), now);
      const effective = effectiveStrength(
        memory.strength,
        days,
        config.decayRate,
      );

      if (effective < config.evictionThreshold) {
        continue;
      }
      if (effective < minStrength) {
        continue;
      }

      primary.push({
        expanded: false,
        memory: { ...memory, strength: effective },
        score: rrfScore,
      });
    }

    // --- Link expansion ---
    const primaryIds = new Set(primary.map((r) => r.memory.id));
    const expandedResults: SearchResult[] = [];

    for (const result of primary) {
      const relatedLinks = links.related(result.memory.id);
      for (const link of relatedLinks) {
        const linkedId =
          link.sourceId === result.memory.id ? link.targetId : link.sourceId;
        if (primaryIds.has(linkedId)) {
          continue;
        }

        const linkedMemory = store.get(linkedId);
        if (!linkedMemory || !linkedMemory.current) {
          continue;
        }

        const days = daysBetween(new Date(linkedMemory.updated), now);
        const effective = effectiveStrength(
          linkedMemory.strength,
          days,
          config.decayRate,
        );

        if (effective < config.evictionThreshold) {
          continue;
        }
        if (effective < minStrength) {
          continue;
        }

        // Link expansion score: source RRF score * decayed link weight * linked memory effective strength
        // This keeps link-expanded results on the same scale as direct matches and ensures
        // they never exceed the score of the source that surfaced them.
        const linkDays = daysBetween(new Date(link.updated), now);
        const decayedWeight = link.weight * config.decayRate ** linkDays;
        const linkScore = result.score * decayedWeight * effective;

        expandedResults.push({
          expanded: true,
          memory: { ...linkedMemory, strength: effective },
          score: linkScore,
        });
        primaryIds.add(linkedId);
      }
    }

    // --- Lineage diversification ---
    // Max 3 results from the same version chain to prevent one concept
    // from dominating results.
    const all = [...primary, ...expandedResults];
    all.sort((a, b) => b.score - a.score);

    const diversified: SearchResult[] = [];
    const lineageCounts = new Map<string, number>();
    const maxPerLineage = 3;

    for (const result of all) {
      // Walk back to find the root of the version chain
      let rootId = result.memory.id;
      let current = result.memory;
      while (current.parentId) {
        rootId = current.parentId;
        const parent = store.get(current.parentId);
        if (!parent) {
          break;
        }
        current = parent;
      }

      const count = lineageCounts.get(rootId) ?? 0;
      if (count >= maxPerLineage) {
        continue;
      }

      diversified.push(result);
      lineageCounts.set(rootId, count + 1);

      if (diversified.length >= limit) {
        break;
      }
    }

    // --- Reinforce returned memories ---
    const reinforceStmt = database.prepare(
      'UPDATE memories SET strength = ?, updated = ? WHERE id = ?',
    );
    const nowIso = now.toISOString();

    for (const result of diversified) {
      const reinforced = reinforce(
        result.memory.strength,
        config.reinforcementBoost,
      );
      reinforceStmt.run(reinforced, nowIso, result.memory.id);
      result.memory.strength = reinforced;
    }

    return diversified;
  }

  return { search };
}

export { createSearch };
export type { Search };
