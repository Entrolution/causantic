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

import { reorderWithMMR, computeEffectiveLambda, type MMRConfig } from '../../src/retrieval/mmr.js';

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

  describe('budget-aware selection', () => {
    it('excludes candidates that exceed remaining budget', async () => {
      // 12 candidates: first 3 are large (500 each), rest are small (100 each)
      const candidates: RankedItem[] = [];
      const tokenCounts = new Map<string, number>();
      for (let i = 0; i < 12; i++) {
        candidates.push(makeItem(`c${i}`, 1.0 - i * 0.05));
        mockEmbeddings.set(`c${i}`, makeEmbedding([1, 0.01 * i]));
        tokenCounts.set(`c${i}`, i < 3 ? 500 : 100);
      }

      const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig, {
        tokenBudget: 1000,
        chunkTokenCounts: tokenCounts,
      });

      // Total budget: 1000. Large chunks (500 each) take at most 2 slots.
      // Remaining budget goes to small chunks (100 each).
      const totalTokens = result.reduce((s, r) => s + (tokenCounts.get(r.chunkId) ?? 0), 0);
      expect(totalTokens).toBeLessThanOrEqual(1000);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(12);
    });

    it('stops when no candidate fits remaining budget', async () => {
      const candidates = Array.from({ length: 12 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.05));
      const tokenCounts = new Map<string, number>();
      for (const c of candidates) {
        mockEmbeddings.set(c.chunkId, makeEmbedding([1, 0]));
        tokenCounts.set(c.chunkId, 600); // Each chunk = 600 tokens
      }

      const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig, {
        tokenBudget: 1000,
        chunkTokenCounts: tokenCounts,
      });

      // Budget 1000, each chunk 600 → only 1 fits
      expect(result).toHaveLength(1);
    });

    it('applies budget filtering below MMR threshold', async () => {
      // 5 candidates (below threshold of 10) — MMR skipped but budget still applies
      const candidates = Array.from({ length: 5 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.1));
      const tokenCounts = new Map<string, number>();
      tokenCounts.set('c0', 300);
      tokenCounts.set('c1', 300);
      tokenCounts.set('c2', 300);
      tokenCounts.set('c3', 100);
      tokenCounts.set('c4', 100);

      const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig, {
        tokenBudget: 500,
        chunkTokenCounts: tokenCounts,
      });

      // c0(300) fits, c1(300) doesn't (600 > 500), c2(300) doesn't,
      // c3(100) fits (400 <= 500), c4(100) fits (500 <= 500)
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.chunkId)).toEqual(['c0', 'c3', 'c4']);
    });

    it('without budget, below-threshold candidates returned unchanged', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.1));
      const result = await reorderWithMMR(candidates, queryEmbedding, defaultConfig);
      expect(result).toEqual(candidates);
    });
  });
});

describe('computeEffectiveLambda', () => {
  function makeCandidates(n: number): RankedItem[] {
    return Array.from({ length: n }, (_, i) => makeItem(`c${i}`, 1.0 - i * 0.01));
  }

  function makeTokenCounts(candidates: RankedItem[], tokenSize: number): Map<string, number> {
    const map = new Map<string, number>();
    for (const c of candidates) map.set(c.chunkId, tokenSize);
    return map;
  }

  it('returns baseLambda when no budget provided', () => {
    const candidates = makeCandidates(20);
    expect(computeEffectiveLambda(0.7, candidates)).toBe(0.7);
  });

  it('returns baseLambda when estimated slots >= threshold (15)', () => {
    const candidates = makeCandidates(20);
    // 20000 budget / 1000 tokens per chunk = 20 slots >= 15
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: makeTokenCounts(candidates, 1000),
    });
    expect(result).toBe(0.7);
  });

  it('increases lambda toward 1.0 when slots are tight', () => {
    const candidates = makeCandidates(20);
    // 20000 budget / 3000 tokens per chunk ≈ 6.67 slots < 15
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: makeTokenCounts(candidates, 3000),
    });
    expect(result).toBeGreaterThan(0.7);
    expect(result).toBeLessThan(1.0);
  });

  it('approaches 1.0 (pure relevance) when very few slots available', () => {
    const candidates = makeCandidates(20);
    // 20000 budget / 10000 tokens per chunk = 2 slots → very tight
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: makeTokenCounts(candidates, 10000),
    });
    expect(result).toBeGreaterThan(0.9);
  });

  it('returns 1.0 when zero slots available', () => {
    const candidates = makeCandidates(20);
    // Budget too small for even one chunk
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 100,
      chunkTokenCounts: makeTokenCounts(candidates, 5000),
    });
    // estimatedSlots ≈ 0.02, tightness ≈ 1.0, lambda ≈ 1.0
    expect(result).toBeCloseTo(1.0, 1);
  });

  it('returns baseLambda when no token counts available', () => {
    const candidates = makeCandidates(20);
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: new Map(), // empty
    });
    expect(result).toBe(0.7);
  });

  it('uses median chunk size, not mean', () => {
    const candidates = makeCandidates(20);
    const tokenCounts = new Map<string, number>();
    // 19 small chunks + 1 huge outlier
    for (let i = 0; i < 19; i++) tokenCounts.set(`c${i}`, 1000);
    tokenCounts.set('c19', 50000);
    // Median = 1000, so estimatedSlots = 20000/1000 = 20 >= 15 → baseLambda
    // If mean were used: mean ≈ 3450, slots ≈ 5.8 → lambda would increase
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: tokenCounts,
    });
    expect(result).toBe(0.7);
  });

  it('works with realistic causantic chunk sizes (3-4K median)', () => {
    const candidates = makeCandidates(50);
    const tokenCounts = new Map<string, number>();
    // Simulate real distribution: median around 3500
    for (let i = 0; i < 50; i++) {
      tokenCounts.set(`c${i}`, 2000 + (i % 10) * 300); // 2000-4700
    }
    const result = computeEffectiveLambda(0.7, candidates, {
      tokenBudget: 20000,
      chunkTokenCounts: tokenCounts,
    });
    // Median ≈ 3500, slots ≈ 5.7 → lambda should increase
    expect(result).toBeGreaterThan(0.7);
    expect(result).toBeLessThan(1.0);
  });
});
