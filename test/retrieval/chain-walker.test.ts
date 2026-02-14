/**
 * Tests for chain walker.
 *
 * Uses vi.mock to stub storage layer (edge-store, chunk-store, vector-store).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredChunk, StoredEdge } from '../../src/storage/types.js';

// --- Mocks ---

const mockChunks = new Map<string, StoredChunk>();
const mockForwardEdges = new Map<string, StoredEdge[]>();
const mockBackwardEdges = new Map<string, StoredEdge[]>();
const mockEmbeddings = new Map<string, number[]>();

vi.mock('../../src/storage/chunk-store.js', () => ({
  getChunkById: (id: string) => mockChunks.get(id) ?? null,
}));

vi.mock('../../src/storage/edge-store.js', () => ({
  getForwardEdges: (id: string) => mockForwardEdges.get(id) ?? [],
  getBackwardEdges: (id: string) => mockBackwardEdges.get(id) ?? [],
}));

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {
    get: async (id: string) => mockEmbeddings.get(id) ?? null,
  },
}));

// --- Helpers ---

function makeChunk(id: string, overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    id,
    sessionId: 'session-1',
    sessionSlug: 'test-project',
    projectPath: '/test',
    role: 'assistant',
    content: `Content for ${id}`,
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:01:00Z',
    turnIndex: 0,
    chunkIndex: 0,
    approxTokens: 100,
    ...overrides,
  };
}

function makeEdge(source: string, target: string, id?: string): StoredEdge {
  return {
    id: id ?? `edge-${source}-${target}`,
    sourceChunkId: source,
    targetChunkId: target,
    edgeType: 'forward',
    referenceType: 'within-chain',
    initialWeight: 1.0,
    createdAt: '2024-01-01T00:00:00Z',
    linkCount: 1,
  };
}

/** Normalized embedding vector (unit length). */
function unitVec(...values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

// --- Tests ---

import { walkChains, selectBestChain, type Chain } from '../../src/retrieval/chain-walker.js';

describe('chain-walker', () => {
  beforeEach(() => {
    mockChunks.clear();
    mockForwardEdges.clear();
    mockBackwardEdges.clear();
    mockEmbeddings.clear();
  });

  describe('walkChains', () => {
    it('walks a simple forward chain', async () => {
      // A → B → C
      mockChunks.set('A', makeChunk('A'));
      mockChunks.set('B', makeChunk('B'));
      mockChunks.set('C', makeChunk('C'));

      mockForwardEdges.set('A', [makeEdge('A', 'B')]);
      mockForwardEdges.set('B', [makeEdge('B', 'C')]);

      const qEmb = unitVec(1, 0, 0);
      mockEmbeddings.set('A', unitVec(0.9, 0.1, 0));
      mockEmbeddings.set('B', unitVec(0.8, 0.2, 0));
      mockEmbeddings.set('C', unitVec(0.7, 0.3, 0));

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds).toEqual(['A', 'B', 'C']);
      expect(chains[0].chunks.length).toBe(3);
      expect(chains[0].tokenCount).toBe(300);
      expect(chains[0].score).toBeGreaterThan(0);
      expect(chains[0].nodeScores.length).toBe(3);
      expect(chains[0].medianScore).toBeGreaterThan(0);
    });

    it('walks a simple backward chain', async () => {
      // A → B → C — walk backward from C should yield C, B, A
      mockChunks.set('A', makeChunk('A'));
      mockChunks.set('B', makeChunk('B'));
      mockChunks.set('C', makeChunk('C'));

      mockBackwardEdges.set('C', [makeEdge('B', 'C')]);
      mockBackwardEdges.set('B', [makeEdge('A', 'B')]);

      const qEmb = unitVec(1, 0, 0);
      mockEmbeddings.set('A', unitVec(0.9, 0.1, 0));
      mockEmbeddings.set('B', unitVec(0.8, 0.2, 0));
      mockEmbeddings.set('C', unitVec(0.7, 0.3, 0));

      const chains = await walkChains(['C'], {
        direction: 'backward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds).toEqual(['C', 'B', 'A']);
    });

    it('respects token budget', async () => {
      // A → B → C → D, budget only allows 2 chunks (200 tokens)
      for (const id of ['A', 'B', 'C', 'D']) {
        mockChunks.set(id, makeChunk(id));
      }
      mockForwardEdges.set('A', [makeEdge('A', 'B')]);
      mockForwardEdges.set('B', [makeEdge('B', 'C')]);
      mockForwardEdges.set('C', [makeEdge('C', 'D')]);

      const qEmb = unitVec(1, 0, 0);
      for (const id of ['A', 'B', 'C', 'D']) {
        mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
      }

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 200,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds.length).toBe(2);
      expect(chains[0].tokenCount).toBe(200);
    });

    it('handles cycles via visited set', async () => {
      // A → B → A (cycle)
      mockChunks.set('A', makeChunk('A'));
      mockChunks.set('B', makeChunk('B'));

      mockForwardEdges.set('A', [makeEdge('A', 'B')]);
      mockForwardEdges.set('B', [makeEdge('B', 'A')]);

      const qEmb = unitVec(1, 0, 0);
      mockEmbeddings.set('A', unitVec(1, 0, 0));
      mockEmbeddings.set('B', unitVec(0.9, 0.1, 0));

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds).toEqual(['A', 'B']);
    });

    it('produces multiple chains from multiple seeds', async () => {
      // Seed X → Y (chain 1)
      // Seed P → Q (chain 2, separate subgraph)
      mockChunks.set('X', makeChunk('X'));
      mockChunks.set('Y', makeChunk('Y'));
      mockChunks.set('P', makeChunk('P'));
      mockChunks.set('Q', makeChunk('Q'));

      mockForwardEdges.set('X', [makeEdge('X', 'Y')]);
      mockForwardEdges.set('P', [makeEdge('P', 'Q')]);

      const qEmb = unitVec(1, 0, 0);
      for (const id of ['X', 'Y', 'P', 'Q']) {
        mockEmbeddings.set(id, unitVec(0.8, 0.2, 0));
      }

      const chains = await walkChains(['X', 'P'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(2);
      expect(chains[0].chunkIds).toEqual(['X', 'Y']);
      expect(chains[1].chunkIds).toEqual(['P', 'Q']);
    });

    it('shared visited set prevents duplicate chunks across chains', async () => {
      // Seed A → B → C
      // Seed B (already visited) — should produce empty chain
      mockChunks.set('A', makeChunk('A'));
      mockChunks.set('B', makeChunk('B'));
      mockChunks.set('C', makeChunk('C'));

      mockForwardEdges.set('A', [makeEdge('A', 'B')]);
      mockForwardEdges.set('B', [makeEdge('B', 'C')]);

      const qEmb = unitVec(1, 0, 0);
      for (const id of ['A', 'B', 'C']) {
        mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
      }

      const chains = await walkChains(['A', 'B'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      // Only one chain — B is already visited by chain from A
      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds).toEqual(['A', 'B', 'C']);
    });

    it('respects maxDepth', async () => {
      // Long chain A → B → C → D → E, but maxDepth = 2
      for (const id of ['A', 'B', 'C', 'D', 'E']) {
        mockChunks.set(id, makeChunk(id));
      }
      mockForwardEdges.set('A', [makeEdge('A', 'B')]);
      mockForwardEdges.set('B', [makeEdge('B', 'C')]);
      mockForwardEdges.set('C', [makeEdge('C', 'D')]);
      mockForwardEdges.set('D', [makeEdge('D', 'E')]);

      const qEmb = unitVec(1, 0, 0);
      for (const id of ['A', 'B', 'C', 'D', 'E']) {
        mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
      }

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
        maxDepth: 2,
      });

      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds.length).toBe(2);
    });

    it('returns empty array when seed chunk not found', async () => {
      const qEmb = unitVec(1, 0, 0);

      const chains = await walkChains(['nonexistent'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains).toEqual([]);
    });

    it('returns empty chain for orphan seed with no edges', async () => {
      mockChunks.set('orphan', makeChunk('orphan'));
      mockEmbeddings.set('orphan', unitVec(1, 0, 0));

      const chains = await walkChains(['orphan'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: unitVec(1, 0, 0),
      });

      // Single-chunk chain
      expect(chains.length).toBe(1);
      expect(chains[0].chunkIds).toEqual(['orphan']);
    });

    it('scores nodes by cosine similarity to query', async () => {
      mockChunks.set('A', makeChunk('A'));
      mockChunks.set('B', makeChunk('B'));
      mockForwardEdges.set('A', [makeEdge('A', 'B')]);

      const qEmb = unitVec(1, 0, 0);
      // A is very similar to query
      mockEmbeddings.set('A', unitVec(1, 0, 0));
      // B is less similar
      mockEmbeddings.set('B', unitVec(0, 1, 0));

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: qEmb,
      });

      expect(chains.length).toBe(1);
      // Score for A = 1 - angularDistance([1,0,0],[1,0,0]) = 1.0
      // Score for B = 1 - angularDistance([1,0,0],[0,1,0]) = 1 - 0.5 = 0.5
      // Total = 1.5
      expect(chains[0].score).toBeCloseTo(1.5, 1);
    });

    it('handles missing embedding gracefully (score = 0)', async () => {
      mockChunks.set('A', makeChunk('A'));
      // No embedding for A

      const chains = await walkChains(['A'], {
        direction: 'forward',
        tokenBudget: 10000,
        queryEmbedding: unitVec(1, 0, 0),
      });

      expect(chains.length).toBe(1);
      expect(chains[0].score).toBe(0);
    });
  });

  describe('selectBestChain', () => {
    it('selects chain with highest medianScore', () => {
      const chains: Chain[] = [
        {
          chunkIds: ['A', 'B'],
          chunks: [],
          nodeScores: [0.5, 0.5],
          score: 1.0,
          tokenCount: 200,
          medianScore: 0.5,
        },
        {
          chunkIds: ['C', 'D'],
          chunks: [],
          nodeScores: [0.8, 0.7],
          score: 1.5,
          tokenCount: 200,
          medianScore: 0.75,
        },
        {
          chunkIds: ['E', 'F'],
          chunks: [],
          nodeScores: [0.4, 0.4],
          score: 0.8,
          tokenCount: 200,
          medianScore: 0.4,
        },
      ];

      const best = selectBestChain(chains);
      expect(best).toBeDefined();
      expect(best!.chunkIds).toEqual(['C', 'D']);
    });

    it('median is robust to outlier node in short chain', () => {
      // Chain 1: consistent but moderate scores
      // Chain 2: two strong nodes + one weak outlier — median should still win
      const chains: Chain[] = [
        {
          chunkIds: ['A', 'B', 'C'],
          chunks: [],
          nodeScores: [0.6, 0.6, 0.6],
          score: 1.8,
          tokenCount: 300,
          medianScore: 0.6,
        },
        {
          chunkIds: ['D', 'E', 'F'],
          chunks: [],
          nodeScores: [0.85, 0.3, 0.82],
          score: 1.97,
          tokenCount: 300,
          medianScore: 0.82,
        },
      ];

      const best = selectBestChain(chains);
      expect(best).toBeDefined();
      // Chain 2 wins because median (0.82) > Chain 1 median (0.6),
      // even though it has an outlier node at 0.3
      expect(best!.chunkIds).toEqual(['D', 'E', 'F']);
    });

    it('requires chains with at least 2 chunks', () => {
      const chains: Chain[] = [
        {
          chunkIds: ['A'],
          chunks: [],
          nodeScores: [0.9],
          score: 10,
          tokenCount: 100,
          medianScore: 0.9,
        },
        {
          chunkIds: ['B', 'C'],
          chunks: [],
          nodeScores: [0.5, 0.5],
          score: 1,
          tokenCount: 200,
          medianScore: 0.5,
        },
      ];

      const best = selectBestChain(chains);
      expect(best).toBeDefined();
      expect(best!.chunkIds).toEqual(['B', 'C']);
    });

    it('returns null when no chain has 2+ chunks', () => {
      const chains: Chain[] = [
        {
          chunkIds: ['A'],
          chunks: [],
          nodeScores: [0.9],
          score: 10,
          tokenCount: 100,
          medianScore: 0.9,
        },
      ];

      expect(selectBestChain(chains)).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(selectBestChain([])).toBeNull();
    });
  });
});
