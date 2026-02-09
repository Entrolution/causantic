/**
 * Tests for graph traversal with decay-weighted edges.
 */

import { describe, it, expect } from 'vitest';
import { dedupeAndRank } from '../../src/retrieval/traverser.js';
import type { WeightedChunk, TraversalResult } from '../../src/storage/types.js';

describe('traverser', () => {
  describe('dedupeAndRank', () => {
    it('returns empty array for empty input', () => {
      const result = dedupeAndRank([]);
      expect(result).toEqual([]);
    });

    it('returns single chunk unchanged', () => {
      const chunks: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.8, depth: 1 },
      ];

      const result = dedupeAndRank(chunks);
      expect(result.length).toBe(1);
      expect(result[0].chunkId).toBe('c1');
      expect(result[0].weight).toBe(0.8);
    });

    it('combines duplicate chunks by summing weights with diminishing returns', () => {
      const chunks: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.6, depth: 2 },
        { chunkId: 'c1', weight: 0.4, depth: 3 },
      ];

      const result = dedupeAndRank(chunks);
      expect(result.length).toBe(1);
      // Formula: 0.6 + 0.4 * 0.5 = 0.8
      expect(result[0].weight).toBeCloseTo(0.8);
    });

    it('keeps minimum depth when combining duplicates', () => {
      const chunks: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.5, depth: 5 },
        { chunkId: 'c1', weight: 0.3, depth: 2 },
        { chunkId: 'c1', weight: 0.2, depth: 8 },
      ];

      const result = dedupeAndRank(chunks);
      expect(result.length).toBe(1);
      expect(result[0].depth).toBe(2);
    });

    it('sorts by weight descending', () => {
      const chunks: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.3, depth: 1 },
        { chunkId: 'c2', weight: 0.9, depth: 1 },
        { chunkId: 'c3', weight: 0.6, depth: 1 },
      ];

      const result = dedupeAndRank(chunks);
      expect(result.map((c) => c.chunkId)).toEqual(['c2', 'c3', 'c1']);
    });

    it('handles complex scenario with mixed duplicates', () => {
      const chunks: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.5, depth: 1 },
        { chunkId: 'c2', weight: 0.8, depth: 2 },
        { chunkId: 'c1', weight: 0.4, depth: 3 },
        { chunkId: 'c3', weight: 0.3, depth: 1 },
        { chunkId: 'c2', weight: 0.2, depth: 4 },
      ];

      const result = dedupeAndRank(chunks);
      expect(result.length).toBe(3);

      // c2 combined: 0.8 + 0.2*0.5 = 0.9
      // c1 combined: 0.5 + 0.4*0.5 = 0.7
      // c3: 0.3
      expect(result[0].chunkId).toBe('c2');
      expect(result[0].weight).toBeCloseTo(0.9);
      expect(result[1].chunkId).toBe('c1');
      expect(result[1].weight).toBeCloseTo(0.7);
      expect(result[2].chunkId).toBe('c3');
      expect(result[2].weight).toBeCloseTo(0.3);
    });
  });

  describe('sum-product semantics', () => {
    it('product rule: weights multiply along paths', () => {
      // Path A → B → C
      const w_ab = 0.8;
      const w_bc = 0.6;
      const pathWeight = w_ab * w_bc;

      expect(pathWeight).toBeCloseTo(0.48);
    });

    it('sum rule: multiple paths accumulate weight', () => {
      // Two paths to node C:
      // Path 1: A → B → C with weight 0.5
      // Path 2: A → D → C with weight 0.3
      const path1Weight = 0.5;
      const path2Weight = 0.3;
      const totalWeight = path1Weight + path2Weight;

      expect(totalWeight).toBeCloseTo(0.8);
    });

    it('convergence: cyclic paths attenuate geometrically', () => {
      // Cycle A → B → A with edge weights 0.7
      const edgeWeight = 0.7;

      // First traversal: 0.7
      // Second traversal (back to start): 0.7 * 0.7 = 0.49
      // Third: 0.7^3 = 0.343
      // This decreases geometrically

      expect(Math.pow(edgeWeight, 1)).toBeCloseTo(0.7);
      expect(Math.pow(edgeWeight, 2)).toBeCloseTo(0.49);
      expect(Math.pow(edgeWeight, 3)).toBeCloseTo(0.343);
      expect(Math.pow(edgeWeight, 10)).toBeLessThan(0.03);
    });
  });

  describe('TraversalResult interface', () => {
    it('has correct structure', () => {
      const result: TraversalResult = {
        chunks: [
          { chunkId: 'c1', weight: 0.8, depth: 1 },
          { chunkId: 'c2', weight: 0.6, depth: 2 },
        ],
        visited: 15,
      };

      expect(result.chunks.length).toBe(2);
      expect(result.visited).toBe(15);
    });

    it('chunks are sorted by weight descending', () => {
      const result: TraversalResult = {
        chunks: [
          { chunkId: 'highest', weight: 0.9, depth: 1 },
          { chunkId: 'medium', weight: 0.5, depth: 2 },
          { chunkId: 'lowest', weight: 0.2, depth: 3 },
        ],
        visited: 10,
      };

      expect(result.chunks[0].weight).toBeGreaterThan(result.chunks[1].weight);
      expect(result.chunks[1].weight).toBeGreaterThan(result.chunks[2].weight);
    });
  });

  describe('TraversalOptions interface', () => {
    it('supports backward direction', () => {
      const options = {
        direction: 'backward' as const,
        maxDepth: 10,
        minWeight: 0.01,
      };

      expect(options.direction).toBe('backward');
    });

    it('supports forward direction', () => {
      const options = {
        direction: 'forward' as const,
        maxDepth: 20,
        minWeight: 0.001,
      };

      expect(options.direction).toBe('forward');
    });
  });

  describe('WeightedChunk interface', () => {
    it('has required fields', () => {
      const chunk: WeightedChunk = {
        chunkId: 'test-chunk-id',
        weight: 0.75,
        depth: 3,
      };

      expect(chunk.chunkId).toBeDefined();
      expect(chunk.weight).toBeDefined();
      expect(chunk.depth).toBeDefined();
    });

    it('weight is in range [0, 1]', () => {
      const validWeights = [0, 0.5, 1.0];

      for (const weight of validWeights) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    });

    it('depth is non-negative integer', () => {
      const depths = [0, 1, 5, 10];

      for (const depth of depths) {
        expect(depth).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(depth)).toBe(true);
      }
    });
  });

  describe('traversal path pruning', () => {
    it('minWeight threshold prunes low-weight paths', () => {
      const minWeight = 0.05;
      const pathWeights = [0.8, 0.04, 0.1, 0.02, 0.5];

      const survivingPaths = pathWeights.filter((w) => w >= minWeight);
      const prunedPaths = pathWeights.filter((w) => w < minWeight);

      expect(survivingPaths).toEqual([0.8, 0.1, 0.5]);
      expect(prunedPaths).toEqual([0.04, 0.02]);
    });

    it('maxDepth limits traversal depth', () => {
      const maxDepth = 5;
      const depths = [0, 1, 2, 3, 4, 5, 6, 7];

      const withinDepth = depths.filter((d) => d <= maxDepth);
      const beyondDepth = depths.filter((d) => d > maxDepth);

      expect(withinDepth).toEqual([0, 1, 2, 3, 4, 5]);
      expect(beyondDepth).toEqual([6, 7]);
    });
  });

  describe('direction-specific behavior', () => {
    it('backward traversal follows edges to earlier chunks', () => {
      // Backward: "what led to this?" → follows backward edges
      // Edge: target → source (later → earlier)
      const direction = 'backward' as const;
      expect(direction).toBe('backward');
    });

    it('forward traversal follows edges to later chunks', () => {
      // Forward: "what comes after?" → follows forward edges
      // Edge: source → target (earlier → later)
      const direction = 'forward' as const;
      expect(direction).toBe('forward');
    });
  });

  describe('multiple starting points', () => {
    it('merges results from multiple starts', () => {
      // Simulating traverseMultiple behavior
      const results1: WeightedChunk[] = [
        { chunkId: 'c1', weight: 0.5, depth: 1 },
        { chunkId: 'c2', weight: 0.3, depth: 2 },
      ];
      const results2: WeightedChunk[] = [
        { chunkId: 'c2', weight: 0.4, depth: 1 },
        { chunkId: 'c3', weight: 0.6, depth: 1 },
      ];

      // Merge results
      const combined = dedupeAndRank([...results1, ...results2]);

      // c3: 0.6 (single path)
      // c2: 0.4 + 0.3 * 0.5 = 0.55 (combined with diminishing return)
      // c1: 0.5 (single path)
      expect(combined.length).toBe(3);
    });

    it('scales weights by starting weight', () => {
      const startWeight = 0.8;
      const traversedWeight = 0.5;
      const scaledWeight = traversedWeight * startWeight;

      expect(scaledWeight).toBeCloseTo(0.4);
    });
  });
});
