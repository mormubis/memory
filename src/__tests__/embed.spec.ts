import { describe, expect, it } from 'vitest';

import { createEmbedder } from '../embed.js';

async function customEmbedLength(text: string): Promise<number[]> {
  return [text.length, 1];
}

async function customEmbedFixed(_text: string): Promise<number[]> {
  return [0.1, 0.2, 0.3];
}

describe('createEmbedder', () => {
  describe('embed', () => {
    it('uses custom embed function when provided', async () => {
      const embedder = createEmbedder(customEmbedLength);
      const result = await embedder.embed('hello');
      expect(result).toEqual([5, 1]);
    });

    it('returns an array of numbers', async () => {
      const embedder = createEmbedder(customEmbedFixed);
      const result = await embedder.embed('test');
      expect(Array.isArray(result)).toBe(true);
      expect(result.every((v) => typeof v === 'number')).toBe(true);
    });
  });

  describe('blob round-trip', () => {
    it('toBlob and fromBlob preserves values', () => {
      const embedder = createEmbedder();
      const original = [0.1, 0.2, 0.3, -0.5, 1];
      const blob = embedder.toBlob(original);
      const restored = embedder.fromBlob(blob);
      expect(restored).toHaveLength(original.length);
      for (const [index, element] of original.entries()) {
        expect(restored[index]).toBeCloseTo(element ?? 0, 5);
      }
    });

    it('produces a Buffer with 4 bytes per float', () => {
      const embedder = createEmbedder();
      const vector = [1, 2, 3];
      const blob = embedder.toBlob(vector);
      expect(blob.byteLength).toBe(vector.length * 4);
    });

    it('handles empty vector', () => {
      const embedder = createEmbedder();
      const blob = embedder.toBlob([]);
      const restored = embedder.fromBlob(blob);
      expect(restored).toHaveLength(0);
    });
  });
});
