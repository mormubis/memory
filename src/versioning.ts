interface VersionCandidate {
  embedding: number[];
  id: string;
  version: number;
}

interface SimilarMatch {
  id: string;
  similarity: number;
  version: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) { return 0; }
  return dot / denom;
}

function findSimilar(queryEmbedding: number[], candidates: VersionCandidate[], threshold: number): SimilarMatch | null {
  let best: SimilarMatch | null = null;
  for (const candidate of candidates) {
    const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { id: candidate.id, similarity, version: candidate.version };
    }
  }
  return best;
}

export { cosineSimilarity, findSimilar };
export type { SimilarMatch, VersionCandidate };
