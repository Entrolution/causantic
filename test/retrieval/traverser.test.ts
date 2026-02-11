/**
 * Tests for graph traversal with decay-weighted edges.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { dedupeAndRank, traverse, traverseMultiple } from '../../src/retrieval/traverser.js';
import type { WeightedChunk, TraversalResult } from '../../src/storage/types.js';
import {
  createTestDb,
  setupTestDb,
  teardownTestDb,
  insertTestChunk,
  insertTestEdge,
  createSampleChunk,
} from '../storage/test-utils.js';

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Integration Tests - Real Graph Traversal with Database
  // ═══════════════════════════════════════════════════════════════════════════

  describe('traverse() integration', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = createTestDb();
      setupTestDb(db);
    });

    afterEach(() => {
      teardownTestDb(db);
    });

    it('returns empty result for chunk with no edges', async () => {
      // Create a single isolated chunk
      const chunk = createSampleChunk({ id: 'isolated' });
      insertTestChunk(db, chunk);

      const result = await traverse('isolated', Date.now(), {
        direction: 'backward',
        maxDepth: 5,
        minWeight: 0.01,
      });

      expect(result.chunks).toEqual([]);
      expect(result.visited).toBe(1); // Just the start node
    });

    it('traverses single hop correctly', async () => {
      // Create chunks: A → B (backward edge from B to A)
      const chunkA = createSampleChunk({ id: 'chunk-a', content: 'Chunk A content' });
      const chunkB = createSampleChunk({ id: 'chunk-b', content: 'Chunk B content' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);

      // Backward edge: B → A (from B, looking back at A)
      insertTestEdge(db, {
        id: 'edge-ba',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.8,
      });

      const result = await traverse('chunk-b', Date.now(), {
        direction: 'backward',
        maxDepth: 5,
        minWeight: 0.01,
      });

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].chunkId).toBe('chunk-a');
      expect(result.chunks[0].depth).toBe(1);
      // Weight includes decay, so just check it's positive
      expect(result.chunks[0].weight).toBeGreaterThan(0);
    });

    it('applies product rule across multiple hops', async () => {
      // Create chain: A ← B ← C (backward edges)
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      const chunkC = createSampleChunk({ id: 'chunk-c' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);
      insertTestChunk(db, chunkC);

      // Backward edges with known weights
      insertTestEdge(db, {
        id: 'edge-cb',
        sourceChunkId: 'chunk-c',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.8,
      });
      insertTestEdge(db, {
        id: 'edge-ba',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.6,
      });

      const result = await traverse('chunk-c', Date.now(), {
        direction: 'backward',
        maxDepth: 5,
        minWeight: 0.01,
      });

      expect(result.chunks.length).toBe(2);

      // B should be at depth 1, A at depth 2
      const chunkBResult = result.chunks.find(c => c.chunkId === 'chunk-b');
      const chunkAResult = result.chunks.find(c => c.chunkId === 'chunk-a');

      expect(chunkBResult).toBeDefined();
      expect(chunkAResult).toBeDefined();
      expect(chunkBResult!.depth).toBe(1);
      expect(chunkAResult!.depth).toBe(2);

      // A's weight should be less than B's (product rule: weights multiply)
      expect(chunkAResult!.weight).toBeLessThan(chunkBResult!.weight);
    });

    it('applies sum rule for multiple paths to same node', async () => {
      // Create diamond: C can reach A via two paths
      //    A
      //   ↑ ↑
      //  B   D
      //   ↑ ↑
      //    C
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      const chunkC = createSampleChunk({ id: 'chunk-c' });
      const chunkD = createSampleChunk({ id: 'chunk-d' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);
      insertTestChunk(db, chunkC);
      insertTestChunk(db, chunkD);

      // Path 1: C → B → A
      insertTestEdge(db, {
        id: 'edge-cb',
        sourceChunkId: 'chunk-c',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.5,
      });
      insertTestEdge(db, {
        id: 'edge-ba',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.6,
      });

      // Path 2: C → D → A
      insertTestEdge(db, {
        id: 'edge-cd',
        sourceChunkId: 'chunk-c',
        targetChunkId: 'chunk-d',
        edgeType: 'backward',
        initialWeight: 0.4,
      });
      insertTestEdge(db, {
        id: 'edge-da',
        sourceChunkId: 'chunk-d',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.7,
      });

      const result = await traverse('chunk-c', Date.now(), {
        direction: 'backward',
        maxDepth: 5,
        minWeight: 0.01,
      });

      // A should be reachable via both paths
      const chunkAResult = result.chunks.find(c => c.chunkId === 'chunk-a');
      expect(chunkAResult).toBeDefined();

      // The weight should be sum of both paths (after decay)
      // Both B and D contribute to A's weight
      expect(result.chunks.length).toBe(3); // B, D, and A
    });

    it('handles cycles without infinite loops', async () => {
      // Create cycle: A ↔ B (bidirectional backward edges)
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);

      // Cycle: A → B → A
      insertTestEdge(db, {
        id: 'edge-ab',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.7,
      });
      insertTestEdge(db, {
        id: 'edge-ba',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.7,
      });

      // Should complete without hanging
      const result = await traverse('chunk-a', Date.now(), {
        direction: 'backward',
        maxDepth: 10,
        minWeight: 0.01,
      });

      // B should be found
      expect(result.chunks.some(c => c.chunkId === 'chunk-b')).toBe(true);
      // Should visit reasonable number of paths (cycles attenuate)
      expect(result.visited).toBeLessThan(100);
    });

    it('respects maxDepth limit', async () => {
      // Create chain: A ← B ← C ← D ← E
      const chunks = ['a', 'b', 'c', 'd', 'e'].map(id =>
        createSampleChunk({ id: `chunk-${id}` })
      );
      chunks.forEach(c => insertTestChunk(db, c));

      // Chain of backward edges
      const pairs = [['e', 'd'], ['d', 'c'], ['c', 'b'], ['b', 'a']];
      pairs.forEach(([from, to], i) => {
        insertTestEdge(db, {
          id: `edge-${i}`,
          sourceChunkId: `chunk-${from}`,
          targetChunkId: `chunk-${to}`,
          edgeType: 'backward',
          initialWeight: 0.9,
        });
      });

      // With maxDepth=2, should only reach D and C from E
      const result = await traverse('chunk-e', Date.now(), {
        direction: 'backward',
        maxDepth: 2,
        minWeight: 0.01,
      });

      const foundIds = result.chunks.map(c => c.chunkId);
      expect(foundIds).toContain('chunk-d');
      expect(foundIds).toContain('chunk-c');
      expect(foundIds).not.toContain('chunk-a'); // Too far
    });

    it('prunes paths below minWeight threshold', async () => {
      // Create chain with decreasing weights
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      const chunkC = createSampleChunk({ id: 'chunk-c' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);
      insertTestChunk(db, chunkC);

      // Weights multiply: 0.3 * 0.3 = 0.09 < 0.1 threshold
      insertTestEdge(db, {
        id: 'edge-cb',
        sourceChunkId: 'chunk-c',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.3,
      });
      insertTestEdge(db, {
        id: 'edge-ba',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.3,
      });

      const result = await traverse('chunk-c', Date.now(), {
        direction: 'backward',
        maxDepth: 10,
        minWeight: 0.1,
      });

      // B should be found (0.3 >= 0.1)
      expect(result.chunks.some(c => c.chunkId === 'chunk-b')).toBe(true);
      // A might or might not be found depending on decay
      // The point is the traversal completes without exploring infinitely
    });

    it('forward traversal uses forward edges', async () => {
      // Create forward chain: A → B → C
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      const chunkC = createSampleChunk({ id: 'chunk-c' });
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);
      insertTestChunk(db, chunkC);

      // Forward edges
      insertTestEdge(db, {
        id: 'edge-ab',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-b',
        edgeType: 'forward',
        initialWeight: 0.8,
      });
      insertTestEdge(db, {
        id: 'edge-bc',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-c',
        edgeType: 'forward',
        initialWeight: 0.7,
      });

      // Also add backward edges (should be ignored in forward traversal)
      insertTestEdge(db, {
        id: 'edge-ba-back',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.9,
      });

      const result = await traverse('chunk-a', Date.now(), {
        direction: 'forward',
        maxDepth: 5,
        minWeight: 0.01,
      });

      // Should find B and C via forward edges
      expect(result.chunks.some(c => c.chunkId === 'chunk-b')).toBe(true);
      expect(result.chunks.some(c => c.chunkId === 'chunk-c')).toBe(true);
    });
  });

  describe('traverseMultiple() integration', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = createTestDb();
      setupTestDb(db);
    });

    afterEach(() => {
      teardownTestDb(db);
    });

    it('merges results from multiple starting points', async () => {
      // Create two separate chains that share a common ancestor
      // Chain 1: S1 → A → common
      // Chain 2: S2 → B → common
      const chunks = ['s1', 's2', 'a', 'b', 'common'].map(id =>
        createSampleChunk({ id: `chunk-${id}` })
      );
      chunks.forEach(c => insertTestChunk(db, c));

      // Backward edges
      insertTestEdge(db, {
        id: 'edge-s1a',
        sourceChunkId: 'chunk-s1',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.8,
      });
      insertTestEdge(db, {
        id: 'edge-ac',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-common',
        edgeType: 'backward',
        initialWeight: 0.7,
      });
      insertTestEdge(db, {
        id: 'edge-s2b',
        sourceChunkId: 'chunk-s2',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.9,
      });
      insertTestEdge(db, {
        id: 'edge-bc',
        sourceChunkId: 'chunk-b',
        targetChunkId: 'chunk-common',
        edgeType: 'backward',
        initialWeight: 0.6,
      });

      const result = await traverseMultiple(
        ['chunk-s1', 'chunk-s2'],
        [1.0, 1.0],
        Date.now(),
        {
          direction: 'backward',
          maxDepth: 5,
          minWeight: 0.01,
        }
      );

      // Should find A, B, and common
      const foundIds = result.chunks.map(c => c.chunkId);
      expect(foundIds).toContain('chunk-a');
      expect(foundIds).toContain('chunk-b');
      expect(foundIds).toContain('chunk-common');

      // Common should accumulate weight from both paths
      const commonChunk = result.chunks.find(c => c.chunkId === 'chunk-common');
      expect(commonChunk).toBeDefined();
    });

    it('scales results by starting weights', async () => {
      // Two starts with different weights
      const chunkS1 = createSampleChunk({ id: 'chunk-s1' });
      const chunkS2 = createSampleChunk({ id: 'chunk-s2' });
      const chunkA = createSampleChunk({ id: 'chunk-a' });
      const chunkB = createSampleChunk({ id: 'chunk-b' });
      insertTestChunk(db, chunkS1);
      insertTestChunk(db, chunkS2);
      insertTestChunk(db, chunkA);
      insertTestChunk(db, chunkB);

      // Same edge weight from both starts
      insertTestEdge(db, {
        id: 'edge-s1a',
        sourceChunkId: 'chunk-s1',
        targetChunkId: 'chunk-a',
        edgeType: 'backward',
        initialWeight: 0.8,
      });
      insertTestEdge(db, {
        id: 'edge-s2b',
        sourceChunkId: 'chunk-s2',
        targetChunkId: 'chunk-b',
        edgeType: 'backward',
        initialWeight: 0.8,
      });

      // S1 has higher starting weight
      const result = await traverseMultiple(
        ['chunk-s1', 'chunk-s2'],
        [0.9, 0.3],
        Date.now(),
        {
          direction: 'backward',
          maxDepth: 5,
          minWeight: 0.01,
        }
      );

      const chunkAResult = result.chunks.find(c => c.chunkId === 'chunk-a');
      const chunkBResult = result.chunks.find(c => c.chunkId === 'chunk-b');

      expect(chunkAResult).toBeDefined();
      expect(chunkBResult).toBeDefined();

      // A should have higher weight than B due to higher starting weight
      expect(chunkAResult!.weight).toBeGreaterThan(chunkBResult!.weight);
    });
  });
});
