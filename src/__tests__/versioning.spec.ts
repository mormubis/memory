import { describe, expect, it } from 'vitest';

import { cosineSimilarity, findSimilar } from '../versioning.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  it('handles zero vector returning 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('works for high-dimensional vectors', () => {
    const dim = 384;
    const a = Array.from({ length: dim }, (_, i) => Math.sin(i));
    const b = Array.from({ length: dim }, (_, i) => Math.sin(i));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it('computes partial similarity correctly', () => {
    const a = [1, 0];
    const b = [1, 1];
    // cos(45°) ≈ 0.707
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('findSimilar', () => {
  it('returns null for empty candidates', () => {
    expect(findSimilar([1, 0, 0], [], 0.8)).toBeNull();
  });

  it('returns best match above threshold', () => {
    const candidates = [
      { embedding: [1, 0, 0], id: 'a', version: 1 },
      { embedding: [0.9, 0.1, 0], id: 'b', version: 2 },
    ];
    const query = [1, 0, 0];
    const result = findSimilar(query, candidates, 0.8);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('a');
    expect(result?.similarity).toBeCloseTo(1.0);
  });

  it('returns null when all candidates below threshold', () => {
    const candidates = [{ embedding: [0, 1, 0], id: 'a', version: 1 }];
    const result = findSimilar([1, 0, 0], candidates, 0.9);
    expect(result).toBeNull();
  });

  it('picks highest similarity when multiple above threshold', () => {
    const candidates = [
      { embedding: [1, 0, 0], id: 'perfect', version: 1 },
      { embedding: [0.9, 0.44, 0], id: 'close', version: 1 },
    ];
    // both above 0.8 threshold, 'perfect' should win
    const result = findSimilar([1, 0, 0], candidates, 0.8);
    expect(result?.id).toBe('perfect');
  });

  it('includes version in result', () => {
    const candidates = [{ embedding: [1, 0], id: 'v3', version: 3 }];
    const result = findSimilar([1, 0], candidates, 0.5);
    expect(result?.version).toBe(3);
  });
});
