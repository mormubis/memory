import type { EmbedFunction } from './types.js';

interface Embedder {
  embed: (text: string) => Promise<number[]>;
  fromBlob: (blob: Buffer) => number[];
  toBlob: (vector: number[]) => Buffer;
}

function toBlob(vector: number[]): Buffer {
  const float32 = new Float32Array(vector);
  return Buffer.from(float32.buffer);
}

function fromBlob(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / 4,
  );
  return [...float32];
}

function createEmbedder(customEmbed: EmbedFunction | undefined): Embedder {
  async function embed(text: string): Promise<number[]> {
    if (customEmbed) {
      return customEmbed(text);
    }
    // Lazy-load the default model
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
    const output = await extractor(text, { normalize: true, pooling: 'mean' });
    return [...(output.data as Float32Array)];
  }

  return { embed, fromBlob, toBlob };
}

export { createEmbedder };
export type { Embedder };
