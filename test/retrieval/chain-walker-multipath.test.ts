/**
 * Tests for multi-path chain walking (DFS with backtracking).
 *
 * Verifies branching exploration, bounding limits, agent filter scoping,
 * per-seed independence, and token budget behavior.
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

function makeEdge(source: string, target: string, overrides: Partial<StoredEdge> = {}): StoredEdge {
  return {
    id: `edge-${source}-${target}`,
    sourceChunkId: source,
    targetChunkId: target,
    edgeType: 'forward',
    referenceType: 'within-chain',
    initialWeight: 1.0,
    createdAt: '2024-01-01T00:00:00Z',
    linkCount: 1,
    ...overrides,
  };
}

function unitVec(...values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

// --- Tests ---

import { walkChains, selectBestChain } from '../../src/retrieval/chain-walker.js';

describe('chain-walker multi-path', () => {
  beforeEach(() => {
    mockChunks.clear();
    mockForwardEdges.clear();
    mockBackwardEdges.clear();
    mockEmbeddings.clear();
  });

  it('1. linear chain produces exactly 1 candidate', async () => {
    // A → B → C → D
    for (const id of ['A', 'B', 'C', 'D']) {
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }
    mockForwardEdges.set('A', [makeEdge('A', 'B')]);
    mockForwardEdges.set('B', [makeEdge('B', 'C')]);
    mockForwardEdges.set('C', [makeEdge('C', 'D')]);

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: unitVec(1, 0, 0),
    });

    expect(chains.length).toBe(1);
    expect(chains[0].chunkIds).toEqual(['A', 'B', 'C', 'D']);
  });

  it('2. branching at root produces two candidates', async () => {
    // A → {B, C}
    mockChunks.set('A', makeChunk('A'));
    mockChunks.set('B', makeChunk('B'));
    mockChunks.set('C', makeChunk('C'));

    mockForwardEdges.set('A', [makeEdge('A', 'B'), makeEdge('A', 'C')]);

    // B is more similar to query than C
    const qEmb = unitVec(1, 0, 0);
    mockEmbeddings.set('A', unitVec(0.9, 0.1, 0));
    mockEmbeddings.set('B', unitVec(0.95, 0.05, 0));
    mockEmbeddings.set('C', unitVec(0.5, 0.5, 0));

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: qEmb,
    });

    expect(chains.length).toBe(2);
    const allPaths = chains.map((c) => c.chunkIds);
    expect(allPaths).toContainEqual(['A', 'B']);
    expect(allPaths).toContainEqual(['A', 'C']);

    // selectBestChain picks [A, B] — higher cosine similarity
    const best = selectBestChain(chains);
    expect(best).not.toBeNull();
    expect(best!.chunkIds).toEqual(['A', 'B']);
  });

  it('3. deep branching: A→B→{C,D}', async () => {
    for (const id of ['A', 'B', 'C', 'D']) {
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }

    mockForwardEdges.set('A', [makeEdge('A', 'B')]);
    mockForwardEdges.set('B', [makeEdge('B', 'C'), makeEdge('B', 'D')]);

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: unitVec(1, 0, 0),
    });

    expect(chains.length).toBe(2);
    const allPaths = chains.map((c) => c.chunkIds);
    expect(allPaths).toContainEqual(['A', 'B', 'C']);
    expect(allPaths).toContainEqual(['A', 'B', 'D']);
  });

  it('4. maxDepth emits path at depth limit', async () => {
    // Chain of 60 nodes, maxDepth=10 — should emit path of length 10
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `N${i}`;
      ids.push(id);
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }
    for (let i = 0; i < 59; i++) {
      mockForwardEdges.set(ids[i], [makeEdge(ids[i], ids[i + 1])]);
    }

    const chains = await walkChains([ids[0]], {
      direction: 'forward',
      tokenBudget: 100000,
      queryEmbedding: unitVec(1, 0, 0),
      maxDepth: 10,
    });

    expect(chains.length).toBe(1);
    // Seed at depth 1, then 9 more hops = 10 nodes total
    expect(chains[0].chunkIds.length).toBe(10);
    expect(chains[0].chunkIds[0]).toBe('N0');
    expect(chains[0].chunkIds[9]).toBe('N9');
  });

  it('5. maxExpansionsPerSeed terminates DFS and emits collected candidates', async () => {
    // Binary tree: each node has 2 children, 5 levels deep (31 nodes)
    // With maxExpansions=10, DFS stops early
    const nodeIds: string[] = [];
    for (let i = 0; i < 31; i++) {
      const id = `T${i}`;
      nodeIds.push(id);
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }
    // Build binary tree edges: node i has children 2i+1, 2i+2
    for (let i = 0; i < 15; i++) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      mockForwardEdges.set(nodeIds[i], [
        makeEdge(nodeIds[i], nodeIds[left]),
        makeEdge(nodeIds[i], nodeIds[right]),
      ]);
    }

    const chains = await walkChains([nodeIds[0]], {
      direction: 'forward',
      tokenBudget: 100000,
      queryEmbedding: unitVec(1, 0, 0),
      maxExpansionsPerSeed: 10,
    });

    // Should have emitted at least some candidates before budget ran out
    expect(chains.length).toBeGreaterThan(0);
    // Should NOT have explored all 16 leaf paths
    expect(chains.length).toBeLessThan(16);
  });

  it('6. maxCandidatesPerSeed caps output', async () => {
    // Star graph: A → {B1, B2, ..., B20} — 20 branches
    mockChunks.set('A', makeChunk('A'));
    mockEmbeddings.set('A', unitVec(0.9, 0.1, 0));

    const edges: StoredEdge[] = [];
    for (let i = 1; i <= 20; i++) {
      const id = `B${i}`;
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
      edges.push(makeEdge('A', id));
    }
    mockForwardEdges.set('A', edges);

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 100000,
      queryEmbedding: unitVec(1, 0, 0),
      maxCandidatesPerSeed: 10,
    });

    expect(chains.length).toBe(10);
  });

  it('7. agent filter with branching: consecutiveSkips scoped per frame', async () => {
    // A(match) → {B(no-match) → C(match), D(match)}
    mockChunks.set('A', makeChunk('A', { agentId: 'researcher' }));
    mockChunks.set('B', makeChunk('B', { agentId: 'lead' }));
    mockChunks.set('C', makeChunk('C', { agentId: 'researcher' }));
    mockChunks.set('D', makeChunk('D', { agentId: 'researcher' }));

    mockForwardEdges.set('A', [makeEdge('A', 'B'), makeEdge('A', 'D')]);
    mockForwardEdges.set('B', [makeEdge('B', 'C')]);

    const qEmb = unitVec(1, 0, 0);
    for (const id of ['A', 'B', 'C', 'D']) {
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: qEmb,
      agentFilter: 'researcher',
    });

    // Should have paths through both branches
    // Path via B: A → (skip B) → C → emits [A, C]
    // Path via D: A → D → emits [A, D]
    const allPaths = chains.map((c) => c.chunkIds);
    expect(allPaths).toContainEqual(['A', 'C']);
    expect(allPaths).toContainEqual(['A', 'D']);
  });

  it('8. per-seed independence: same chain explored from different seeds', async () => {
    // A → B → C → D
    for (const id of ['A', 'B', 'C', 'D']) {
      mockChunks.set(id, makeChunk(id));
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }
    mockForwardEdges.set('A', [makeEdge('A', 'B')]);
    mockForwardEdges.set('B', [makeEdge('B', 'C')]);
    mockForwardEdges.set('C', [makeEdge('C', 'D')]);

    const chains = await walkChains(['A', 'C'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: unitVec(1, 0, 0),
    });

    // Seed A: [A, B, C, D]
    // Seed C: [C, D] (independent walk, shares nodes)
    expect(chains.length).toBe(2);
    expect(chains[0].chunkIds).toEqual(['A', 'B', 'C', 'D']);
    expect(chains[1].chunkIds).toEqual(['C', 'D']);
  });

  it('9. token budget per-path: short path emits, long path truncated', async () => {
    // A → {B(500 tokens), C(100 tokens)}, budget=250
    mockChunks.set('A', makeChunk('A', { approxTokens: 100 }));
    mockChunks.set('B', makeChunk('B', { approxTokens: 500 }));
    mockChunks.set('C', makeChunk('C', { approxTokens: 100 }));

    mockForwardEdges.set('A', [makeEdge('A', 'B'), makeEdge('A', 'C')]);

    const qEmb = unitVec(1, 0, 0);
    for (const id of ['A', 'B', 'C']) {
      mockEmbeddings.set(id, unitVec(0.9, 0.1, 0));
    }

    const chains = await walkChains(['A'], {
      direction: 'forward',
      tokenBudget: 250,
      queryEmbedding: qEmb,
    });

    // Both paths emit candidates:
    // Path A→B: B exceeds budget (100+500=600 > 250), emits [A] at truncation
    // Path A→C: fits (100+100=200 <= 250), emits [A, C] at dead end
    expect(chains.length).toBe(2);
    const allPaths = chains.map((c) => c.chunkIds);
    expect(allPaths).toContainEqual(['A']);
    expect(allPaths).toContainEqual(['A', 'C']);
  });

  it('10. orphan seed with no edges emits single-chunk chain', async () => {
    mockChunks.set('orphan', makeChunk('orphan'));
    mockEmbeddings.set('orphan', unitVec(1, 0, 0));

    const chains = await walkChains(['orphan'], {
      direction: 'forward',
      tokenBudget: 10000,
      queryEmbedding: unitVec(1, 0, 0),
    });

    // Single-chunk chain emitted
    expect(chains.length).toBe(1);
    expect(chains[0].chunkIds).toEqual(['orphan']);

    // selectBestChain filters it out (< 2 chunks)
    const best = selectBestChain(chains);
    expect(best).toBeNull();
  });
});
