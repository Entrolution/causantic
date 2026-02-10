import { describe, it, expect } from 'vitest';
import { serializeEmbedding, deserializeEmbedding } from '../../src/utils/embedding-utils.js';

describe('embedding-utils', () => {
  describe('serializeEmbedding', () => {
    it('returns a Buffer', () => {
      const result = serializeEmbedding([1.0, 2.0, 3.0]);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('uses 4 bytes per dimension (Float32)', () => {
      const embedding = [1.0, 2.0, 3.0];
      const result = serializeEmbedding(embedding);
      expect(result.length).toBe(embedding.length * 4);
    });

    it('handles empty embedding', () => {
      const result = serializeEmbedding([]);
      expect(result.length).toBe(0);
    });
  });

  describe('deserializeEmbedding', () => {
    it('returns an array of numbers', () => {
      const buffer = serializeEmbedding([1.0, 2.0, 3.0]);
      const result = deserializeEmbedding(buffer);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('handles empty buffer', () => {
      const buffer = serializeEmbedding([]);
      const result = deserializeEmbedding(buffer);
      expect(result).toEqual([]);
    });
  });

  describe('roundtrip', () => {
    it('preserves values through serialize/deserialize', () => {
      const original = [0.1, 0.5, -0.3, 1.0, 0.0];
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);

      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('preserves high-dimensional embeddings', () => {
      const original = Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.01));
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);

      expect(restored.length).toBe(1024);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('handles negative values', () => {
      const original = [-1.0, -0.5, 0.0, 0.5, 1.0];
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);

      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('handles very small values', () => {
      const original = [1e-7, 1e-10, 0];
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);

      expect(restored[0]).toBeCloseTo(original[0], 5);
    });
  });
});
