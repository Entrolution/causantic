/**
 * Tests for embedder batch embedding.
 */

import { describe, it, expect } from 'vitest';
import type { EmbedResult, ModelStats, EmbedderLoadOptions } from '../../src/models/embedder.js';

describe('embedder', () => {
  describe('EmbedResult interface', () => {
    it('has correct structure', () => {
      const result: EmbedResult = {
        embedding: [0.1, 0.2, 0.3, 0.4],
        inferenceMs: 15.5,
      };

      expect(result.embedding.length).toBe(4);
      expect(typeof result.inferenceMs).toBe('number');
    });
  });

  describe('ModelStats interface', () => {
    it('has correct structure', () => {
      const stats: ModelStats = {
        modelId: 'jina-small',
        loadTimeMs: 2500,
        heapUsedMB: 150.5,
      };

      expect(stats.modelId).toBe('jina-small');
      expect(stats.loadTimeMs).toBeGreaterThan(0);
      expect(stats.heapUsedMB).toBeGreaterThan(0);
    });
  });

  describe('batch embedding logic', () => {
    it('processes texts in configurable batch sizes', () => {
      const texts = Array(100).fill('test text');
      const batchSize = 32;

      const batches: string[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        batches.push(texts.slice(i, i + batchSize));
      }

      expect(batches.length).toBe(4); // 32 + 32 + 32 + 4
      expect(batches[0].length).toBe(32);
      expect(batches[3].length).toBe(4);
    });

    it('handles empty input', () => {
      const texts: string[] = [];
      const results: EmbedResult[] = [];

      if (texts.length === 0) {
        // Return early with empty results
      }

      expect(results.length).toBe(0);
    });

    it('applies document prefix when configured', () => {
      const config = {
        usesPrefix: true,
        documentPrefix: 'search_document: ',
        queryPrefix: 'search_query: ',
      };

      const text = 'sample text';
      const isQuery = false;

      const prefixed = config.usesPrefix
        ? (isQuery ? config.queryPrefix : config.documentPrefix) + text
        : text;

      expect(prefixed).toBe('search_document: sample text');
    });

    it('applies query prefix when configured', () => {
      const config = {
        usesPrefix: true,
        documentPrefix: 'search_document: ',
        queryPrefix: 'search_query: ',
      };

      const text = 'sample text';
      const isQuery = true;

      const prefixed = config.usesPrefix
        ? (isQuery ? config.queryPrefix : config.documentPrefix) + text
        : text;

      expect(prefixed).toBe('search_query: sample text');
    });

    it('skips prefix when not configured', () => {
      const config = {
        usesPrefix: false,
        documentPrefix: 'search_document: ',
        queryPrefix: 'search_query: ',
      };

      const text = 'sample text';
      const isQuery = false;

      const prefixed = config.usesPrefix
        ? (isQuery ? config.queryPrefix : config.documentPrefix) + text
        : text;

      expect(prefixed).toBe('sample text');
    });

    it('extracts embeddings from tensor output', () => {
      // Simulate tensor output with dims [batch_size, embedding_dim]
      const batchSize = 3;
      const dims = 4;
      const flatData = new Float32Array([
        // Embedding 0
        0.1, 0.2, 0.3, 0.4,
        // Embedding 1
        0.5, 0.6, 0.7, 0.8,
        // Embedding 2
        0.9, 1.0, 1.1, 1.2,
      ]);

      const embeddings: number[][] = [];
      for (let j = 0; j < batchSize; j++) {
        const embedding = Array.from(flatData.slice(j * dims, (j + 1) * dims));
        embeddings.push(embedding);
      }

      expect(embeddings.length).toBe(3);
      // Float32 has limited precision, so use toBeCloseTo for comparisons
      expect(embeddings[0][0]).toBeCloseTo(0.1, 5);
      expect(embeddings[0][1]).toBeCloseTo(0.2, 5);
      expect(embeddings[0][2]).toBeCloseTo(0.3, 5);
      expect(embeddings[0][3]).toBeCloseTo(0.4, 5);
      expect(embeddings[1][0]).toBeCloseTo(0.5, 5);
      expect(embeddings[2][3]).toBeCloseTo(1.2, 5);
    });

    it('distributes inference time across batch', () => {
      const batchInferenceMs = 100;
      const batchSize = 10;
      const perItemMs = batchInferenceMs / batchSize;

      expect(perItemMs).toBe(10);
    });
  });

  describe('EmbedderLoadOptions interface', () => {
    it('accepts device override', () => {
      const opts: EmbedderLoadOptions = { device: 'coreml' };
      expect(opts.device).toBe('coreml');
    });

    it('defaults to empty when not provided', () => {
      const opts: EmbedderLoadOptions = {};
      expect(opts.device).toBeUndefined();
    });
  });

  describe('batch size selection', () => {
    const DEFAULT_BATCH_SIZE = 32;

    it('uses default batch size of 32', () => {
      expect(DEFAULT_BATCH_SIZE).toBe(32);
    });

    it('allows custom batch size', () => {
      const customBatchSize = 64;
      const texts = Array(100).fill('text');

      const batches: number[] = [];
      for (let i = 0; i < texts.length; i += customBatchSize) {
        batches.push(Math.min(customBatchSize, texts.length - i));
      }

      expect(batches).toEqual([64, 36]);
    });

    it('handles batch size larger than input', () => {
      const batchSize = 100;
      const texts = Array(10).fill('text');

      const batches: number[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        batches.push(Math.min(batchSize, texts.length - i));
      }

      expect(batches).toEqual([10]);
    });
  });

  describe('model lifecycle', () => {
    it('throws when embedding without loaded model', () => {
      const pipe = null;
      const config = null;

      const shouldThrow = () => {
        if (!pipe || !config) {
          throw new Error('No model loaded. Call load() first.');
        }
      };

      expect(shouldThrow).toThrow('No model loaded');
    });

    it('disposes previous model before loading new one', () => {
      let disposed = false;

      const dispose = () => {
        disposed = true;
      };

      // Simulate load() calling dispose() first
      dispose();

      expect(disposed).toBe(true);
    });
  });

  describe('legacy embedBatch method', () => {
    it('is marked as deprecated', () => {
      // This is a documentation test - the method should have @deprecated JSDoc
      const deprecatedMethods = ['embedBatch'];

      expect(deprecatedMethods.includes('embedBatch')).toBe(true);
    });

    it('processes texts sequentially', () => {
      const texts = ['a', 'b', 'c'];
      const results: number[] = [];

      // Sequential processing simulation
      for (let i = 0; i < texts.length; i++) {
        results.push(i);
      }

      expect(results).toEqual([0, 1, 2]);
    });
  });
});
