/**
 * Tests for Reciprocal Rank Fusion (RRF).
 */

import { describe, it, expect } from 'vitest';
import { fuseRRF, type RankedItem, type RRFSource } from '../../src/retrieval/rrf.js';

describe('rrf', () => {
  describe('fuseRRF', () => {
    it('returns empty for empty sources', () => {
      expect(fuseRRF([])).toEqual([]);
    });

    it('single source passes through ranks', () => {
      const source: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
          { chunkId: 'b', score: 0.5, source: 'vector' },
          { chunkId: 'c', score: 0.2, source: 'vector' },
        ],
        weight: 1.0,
      };

      const result = fuseRRF([source]);

      expect(result.length).toBe(3);
      // Order should be preserved (rank 1 gets highest RRF score)
      expect(result[0].chunkId).toBe('a');
      expect(result[1].chunkId).toBe('b');
      expect(result[2].chunkId).toBe('c');
      // Source should be preserved
      expect(result[0].source).toBe('vector');
    });

    it('two sources with overlap merges correctly', () => {
      const vectorSource: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
          { chunkId: 'b', score: 0.5, source: 'vector' },
        ],
        weight: 1.0,
      };

      const keywordSource: RRFSource = {
        items: [
          { chunkId: 'b', score: 0.8, source: 'keyword' },
          { chunkId: 'c', score: 0.3, source: 'keyword' },
        ],
        weight: 1.0,
      };

      const result = fuseRRF([vectorSource, keywordSource]);

      expect(result.length).toBe(3); // a, b, c
      // 'b' appears in both sources so should have highest fused score
      expect(result[0].chunkId).toBe('b');
      // Source attribution: 'b' appeared in both, vector takes priority
      expect(result[0].source).toBe('vector');
    });

    it('weights affect final ranking', () => {
      const source1: RRFSource = {
        items: [{ chunkId: 'a', score: 0.9, source: 'vector' }],
        weight: 1.0,
      };

      const source2: RRFSource = {
        items: [{ chunkId: 'b', score: 0.9, source: 'keyword' }],
        weight: 2.0, // Double weight
      };

      const result = fuseRRF([source1, source2]);

      // 'b' should rank higher due to 2x weight
      expect(result[0].chunkId).toBe('b');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('custom k parameter changes scores', () => {
      const source: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
          { chunkId: 'b', score: 0.5, source: 'vector' },
        ],
        weight: 1.0,
      };

      const defaultResult = fuseRRF([source], 60);
      const smallKResult = fuseRRF([source], 1);

      // With smaller k, rank differences matter more
      const defaultRatio = defaultResult[0].score / defaultResult[1].score;
      const smallKRatio = smallKResult[0].score / smallKResult[1].score;
      expect(smallKRatio).toBeGreaterThan(defaultRatio);
    });

    it('empty sources return empty results', () => {
      const source1: RRFSource = { items: [], weight: 1.0 };
      const source2: RRFSource = { items: [], weight: 1.0 };

      const result = fuseRRF([source1, source2]);
      expect(result).toEqual([]);
    });

    it('disjoint sources union all items', () => {
      const source1: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
          { chunkId: 'b', score: 0.5, source: 'vector' },
        ],
        weight: 1.0,
      };

      const source2: RRFSource = {
        items: [
          { chunkId: 'c', score: 0.8, source: 'keyword' },
          { chunkId: 'd', score: 0.3, source: 'keyword' },
        ],
        weight: 1.0,
      };

      const result = fuseRRF([source1, source2]);

      expect(result.length).toBe(4);
      const ids = result.map(r => r.chunkId);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
      expect(ids).toContain('d');
    });

    it('source attribution preserved through fusion', () => {
      const source: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
          { chunkId: 'b', score: 0.5, source: 'keyword' },
          { chunkId: 'c', score: 0.2, source: 'cluster' },
        ],
        weight: 1.0,
      };

      const result = fuseRRF([source]);

      expect(result[0].source).toBe('vector');
      expect(result[1].source).toBe('keyword');
      expect(result[2].source).toBe('cluster');
    });

    it('items without source get undefined', () => {
      const source: RRFSource = {
        items: [{ chunkId: 'a', score: 0.9 }],
        weight: 1.0,
      };

      const result = fuseRRF([source]);
      expect(result[0].source).toBeUndefined();
    });

    it('fused scores follow RRF formula', () => {
      const k = 60;
      const source: RRFSource = {
        items: [
          { chunkId: 'a', score: 0.9, source: 'vector' },
        ],
        weight: 1.0,
      };

      const result = fuseRRF([source], k);

      // Expected: weight / (k + rank + 1) where rank is 0-based
      const expected = 1.0 / (k + 0 + 1);
      expect(result[0].score).toBeCloseTo(expected);
    });
  });
});
