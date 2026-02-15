/**
 * Integration tests for semantic forget — verifies score conversion logic
 * and end-to-end flow with mocked embedder/vector store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

let mockVectorResults: Array<{ id: string; distance: number }> = [];
let mockEmbedding: number[] = [1, 0, 0];

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {
    search: async () => mockVectorResults,
    searchByProject: async () => mockVectorResults,
  },
}));

vi.mock('../../src/storage/chunk-store.js', () => ({
  getChunkById: () => null,
}));

vi.mock('../../src/models/embedder.js', () => {
  return {
    Embedder: class MockEmbedder {
      async load() {}
      async embed() {
        return { embedding: mockEmbedding };
      }
      async dispose() {}
    },
  };
});

vi.mock('../../src/models/model-registry.js', () => ({
  getModel: () => ({ name: 'mock-model', path: '/mock' }),
}));

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: () => ({}),
  toRuntimeConfig: () => ({
    mcpMaxResponseTokens: 20000,
    hybridSearch: {
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      keywordSearchLimit: 20,
      rrfK: 60,
    },
    clusterExpansion: {
      enabled: false,
      maxSiblings: 3,
      minClusterSize: 2,
    },
  }),
}));

vi.mock('../../src/storage/keyword-store.js', () => ({
  KeywordStore: class {
    search() {
      return [];
    }
    searchByProject() {
      return [];
    }
  },
}));

vi.mock('../../src/retrieval/cluster-expander.js', () => ({
  expandViaClusters: (items: unknown[]) => items,
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { findSimilarChunkIds, disposeSearch } from '../../src/retrieval/search-assembler.js';

describe('semantic-forget integration', () => {
  beforeEach(() => {
    mockVectorResults = [];
    mockEmbedding = [1, 0, 0];
  });

  afterEach(async () => {
    await disposeSearch();
  });

  it('score conversion: angular distance 0 → 1.0, 0.4 → 0.6, 1.0 → 0.0', async () => {
    mockVectorResults = [
      { id: 'identical', distance: 0 },
      { id: 'threshold', distance: 0.4 },
      { id: 'opposite', distance: 1.0 },
    ];

    const results = await findSimilarChunkIds({
      query: 'test',
      project: 'proj',
      threshold: 0,
    });

    const scoreMap = new Map(results.map((r) => [r.id, r.score]));
    expect(scoreMap.get('identical')).toBe(1.0);
    expect(scoreMap.get('threshold')).toBeCloseTo(0.6, 5);
    expect(scoreMap.get('opposite')).toBe(0.0);
  });

  it('end-to-end: embed → search → filter → returns correct IDs above threshold', async () => {
    mockVectorResults = [
      { id: 'close', distance: 0.1 }, // score 0.9
      { id: 'medium', distance: 0.35 }, // score 0.65
      { id: 'far', distance: 0.6 }, // score 0.4
      { id: 'very-far', distance: 0.9 }, // score 0.1
    ];

    const results = await findSimilarChunkIds({
      query: 'authentication',
      project: 'my-app',
      threshold: 0.6,
    });

    expect(results.length).toBe(2);
    expect(results[0].id).toBe('close');
    expect(results[1].id).toBe('medium');
    expect(results[0].score).toBeCloseTo(0.9, 5);
    expect(results[1].score).toBeCloseTo(0.65, 5);
  });

  it('threshold percentage auto-detection: 60 and 0.6 produce identical results', async () => {
    mockVectorResults = [
      { id: 'c1', distance: 0.2 }, // score 0.8
      { id: 'c2', distance: 0.5 }, // score 0.5
    ];

    const resultsDecimal = await findSimilarChunkIds({
      query: 'test',
      project: 'proj',
      threshold: 0.6,
    });

    const resultsPercent = await findSimilarChunkIds({
      query: 'test',
      project: 'proj',
      threshold: 60,
    });

    expect(resultsDecimal.length).toBe(resultsPercent.length);
    expect(resultsDecimal.map((r) => r.id)).toEqual(resultsPercent.map((r) => r.id));
    expect(resultsDecimal.map((r) => r.score)).toEqual(resultsPercent.map((r) => r.score));
  });
});
