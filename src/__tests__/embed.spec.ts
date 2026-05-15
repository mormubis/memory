import { describe, expect, it } from 'vitest';

import { createEmbedder } from '../embed.js';

describe('createEmbedder', () => {
  describe('embed', () => {
    it('uses custom embed function when provided', async () => {
      const customEmbed = async (text: string) => [text.length, 1.0];
      const embedder = createEmbedder(customEmbed);
      const result = await embedder.embed('hello');
      expect(result).toEqual([5, 1.0]);
    });

    it('returns an array of numbers', async () => {
      const customEmbed = async (_text: string) => [0.1, 0.2, 0.3];
      const embedder = createEmbedder(customEmbed);
      const result = await embedder.embed('test');
      expect(Array.isArray(result)).toBe(true);
      expect(result.every((v) => typeof v === 'number')).toBe(true);
    });
  });

  describe('blob round-trip', () => {
    it('toBlob and fromBlob preserves values', () => {
      const embedder = createEmbedder(null);
      const original = [0.1, 0.2, 0.3, -0.5, 1.0];
      const blob = embedder.toBlob(original);
      const restored = embedder.fromBlob(blob);
      expect(restored).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i]!, 5);
      }
    });

    it('produces a Buffer with 4 bytes per float', () => {
      const embedder = createEmbedder(null);
      const vector = [1.0, 2.0, 3.0];
      const blob = embedder.toBlob(vector);
      expect(blob.byteLength).toBe(vector.length * 4);
    });

    it('handles empty vector', () => {
      const embedder = createEmbedder(null);
      const blob = embedder.toBlob([]);
      const restored = embedder.fromBlob(blob);
      expect(restored).toHaveLength(0);
    });
  });
});
