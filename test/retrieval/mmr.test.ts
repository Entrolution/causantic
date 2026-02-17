/**
 * Tests for MMR (Maximal Marginal Relevance) reranking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RankedItem } from '../../src/retrieval/rrf.js';

// --- Mocks ---

const mockEmbeddings = new Map<string, number[]>();

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {
    get: async (id: string) => mockEmbeddings.get(id) ?? null,
  },
}));

// --- Helpers ---

function makeItem(chunkId: string, score: number, source?: RankedItem['source']): RankedItem {
  return { chunkId, score, source };
}

/**
 * Create an embedding with a dominant direction.
 * Uses unit vectors in high-dimensional space to allow controlled similarity.
 */
function makeEmbedding(direction: number[], dims = 8): number[] {
  const emb = new Array(dims).fill(0);
  for (let i = 0; i < direction.length && i < dims; i++) {
    emb[i] = direction[i];
  }
  // Normalize
  const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < emb.length; i++) emb[i] /= norm;
  }
  return emb;
}

// --- Tests ---

import { reorderWithMMR, type MMRConfig } from '../../src/retrieval/mmr.js';

describe('reorderWithMMR', () => {
  const defaultConfig: MMRConfig = { lambda: 0.7 };
  const queryEmbedding = makeEmbedding([1, 0]);

  beforeEach(() => {
    mockEmbeddings.clear();
  });

  it('returns empty array for empty candidates', async () => {
    const result = await reorderWithMMR([], queryEmbedding, defaultConfig);
    expect(result).toEqual([]);
  });

  it('returns single candidate as-is', async () => {
    const candidates = [makeItem('c1', 1.0)];
    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);
    expect(result).toEqual(candidates);
  });

  it('returns candidates unchanged when below threshold (< 10)', async () => {
    const candidates = Array.from({ length: 9 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.1));
    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);
    expect(result).toEqual(candidates);
  });

  it('applies MMR when at threshold (>= 10 candidates)', async () => {
    // 10 candidates with identical embeddings — MMR should still work
    const candidates = Array.from({ length: 10 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.05));
    for (const c of candidates) {
      mockEmbeddings.set(c.chunkId, makeEmbedding([1, 0]));
    }

    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);
    expect(result).toHaveLength(10);
    // First pick should be highest relevance (c0)
    expect(result[0].chunkId).toBe('c0');
  });

  it('with lambda=1 (pure relevance), preserves original order', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.05));
    for (const c of candidates) {
      mockEmbeddings.set(c.chunkId, makeEmbedding([1, 0]));
    }

    const result = await reorderWithMMR(candidates, queryEmbedding, { lambda: 1 });

    // With lambda=1 the diversity term is zeroed out, so order = pure relevance = original order
    for (let i = 0; i < result.length; i++) {
      expect(result[i].chunkId).toBe(`c${i}`);
    }
  });

  it('with lambda=0 (pure diversity), selects most dissimilar items first', async () => {
    // Create 12 candidates: first 6 cluster in one direction, next 6 in another
    const candidates: RankedItem[] = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(makeItem(`c${i}`, 1.0 - i * 0.01));
    }
    // First 6: similar direction [1, 0]
    for (let i = 0; i < 6; i++) {
      mockEmbeddings.set(`c${i}`, makeEmbedding([1, 0.01 * i]));
    }
    // Next 6: different direction [0, 1]
    for (let i = 6; i < 12; i++) {
      mockEmbeddings.set(`c${i}`, makeEmbedding([0, 1, 0.01 * (i - 6)]));
    }

    const result = await reorderWithMMR(candidates, queryEmbedding, { lambda: 0 });

    // First pick has div=0 (nothing selected), so all have mmr=0. Tie-broken by iteration order → c0.
    // Second pick should be maximally dissimilar from c0 → one of c6-c11
    expect(result[0].chunkId).toBe('c0');
    const secondPickIdx = parseInt(result[1].chunkId.slice(1));
    expect(secondPickIdx).toBeGreaterThanOrEqual(6);
  });

  it('with default lambda=0.7, first pick is top relevance and subsequent picks balance novelty', async () => {
    // Create 12 candidates: top 6 are similar (same direction), bottom 6 are diverse
    const candidates: RankedItem[] = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(makeItem(`c${i}`, 1.0 - i * 0.05));
    }

    // Top 6: all very similar embeddings (nearly identical direction)
    for (let i = 0; i < 6; i++) {
      mockEmbeddings.set(`c${i}`, makeEmbedding([1, 0.001 * i]));
    }
    // Bottom 6: each in a different direction (diverse)
    mockEmbeddings.set('c6', makeEmbedding([0, 1]));
    mockEmbeddings.set('c7', makeEmbedding([0, 0, 1]));
    mockEmbeddings.set('c8', makeEmbedding([0, 0, 0, 1]));
    mockEmbeddings.set('c9', makeEmbedding([0, 0, 0, 0, 1]));
    mockEmbeddings.set('c10', makeEmbedding([0, 0, 0, 0, 0, 1]));
    mockEmbeddings.set('c11', makeEmbedding([0, 0, 0, 0, 0, 0, 1]));

    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);

    // First pick is always top relevance
    expect(result[0].chunkId).toBe('c0');

    // Within the first 6 picks, we should see some of the diverse items promoted
    // compared to pure score order (which would be c0..c5)
    const top6Ids = result.slice(0, 6).map((r) => r.chunkId);
    const diverseInTop6 = top6Ids.filter((id) => parseInt(id.slice(1)) >= 6);
    expect(diverseInTop6.length).toBeGreaterThan(0);
  });

  it('candidates without embeddings are treated as novel (diversity=0)', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.05));

    // Only give embeddings to first 6 (all similar)
    for (let i = 0; i < 6; i++) {
      mockEmbeddings.set(`c${i}`, makeEmbedding([1, 0.001 * i]));
    }
    // c6-c11 have no embeddings → treated as novel

    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);

    // Items without embeddings should be promoted since they can't be penalised for redundancy
    const top8Ids = result.slice(0, 8).map((r) => r.chunkId);
    const noEmbInTop8 = top8Ids.filter((id) => parseInt(id.slice(1)) >= 6);
    expect(noEmbInTop8.length).toBeGreaterThan(0);
  });

  it('preserves original scores (MMR only changes order)', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      makeItem(`c${i}`, 1.0 - i * 0.05, 'vector'),
    );
    for (const c of candidates) {
      mockEmbeddings.set(c.chunkId, makeEmbedding([1, 0]));
    }

    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);

    // Every original candidate should appear exactly once with its original score
    const scoreMap = new Map(candidates.map((c) => [c.chunkId, c.score]));
    for (const r of result) {
      expect(r.score).toBe(scoreMap.get(r.chunkId));
      expect(r.source).toBe('vector');
    }
    expect(result).toHaveLength(candidates.length);
  });

  it('preserves source attribution through reranking', async () => {
    const candidates: RankedItem[] = [
      ...Array.from({ length: 5 }, (_, i) => makeItem(`v${i}`, 1.0 - i * 0.05, 'vector')),
      ...Array.from({ length: 5 }, (_, i) => makeItem(`k${i}`, 0.7 - i * 0.05, 'keyword')),
      ...Array.from({ length: 2 }, (_, i) => makeItem(`cl${i}`, 0.4 - i * 0.05, 'cluster')),
    ];
    for (const c of candidates) {
      mockEmbeddings.set(c.chunkId, makeEmbedding([1, 0]));
    }

    const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);

    // All sources should be preserved
    for (const r of result) {
      const original = candidates.find((c) => c.chunkId === r.chunkId);
      expect(r.source).toBe(original?.source);
    }
  });
});
