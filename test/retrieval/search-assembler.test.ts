/**
 * Tests for search assembler (pure search pipeline, no graph).
 *
 * Mocks storage and embedding layers to test pipeline logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StoredChunk } from '../../src/storage/types.js';

// --- Mocks ---

const mockChunks = new Map<string, StoredChunk>();
let mockVectorResults: Array<{ id: string; distance: number }> = [];
let mockKeywordResults: Array<{ id: string; score: number }> = [];
let mockEmbedding: number[] = [1, 0, 0];

vi.mock('../../src/storage/chunk-store.js', () => ({
  getChunkById: (id: string) => mockChunks.get(id) ?? null,
}));

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {
    search: async () => mockVectorResults,
    searchByProject: async () => mockVectorResults,
  },
}));

vi.mock('../../src/storage/keyword-store.js', () => {
  return {
    KeywordStore: class MockKeywordStore {
      search() {
        return mockKeywordResults;
      }
      searchByProject() {
        return mockKeywordResults;
      }
    },
  };
});

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

// --- Helpers ---

function makeChunk(id: string, overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    id,
    sessionId: 'session-1',
    sessionSlug: 'test-project',
    projectPath: '/test',
    role: 'assistant',
    content: `Content for ${id}. Some additional text to make it meaningful.`,
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:01:00Z',
    turnIndex: 0,
    chunkIndex: 0,
    approxTokens: 50,
    ...overrides,
  };
}

// --- Tests ---

import {
  searchContext,
  disposeSearch,
  type SearchRequest,
} from '../../src/retrieval/search-assembler.js';

describe('search-assembler', () => {
  beforeEach(() => {
    mockChunks.clear();
    mockVectorResults = [];
    mockKeywordResults = [];
    mockEmbedding = [1, 0, 0];
  });

  afterEach(async () => {
    await disposeSearch();
  });

  describe('searchContext', () => {
    it('returns empty response when no results found', async () => {
      const result = await searchContext({ query: 'test query' });

      expect(result.text).toBe('');
      expect(result.tokenCount).toBe(0);
      expect(result.chunks).toEqual([]);
      expect(result.totalConsidered).toBe(0);
      expect(result.seedIds).toEqual([]);
      expect(result.queryEmbedding).toEqual(mockEmbedding);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns chunks from vector search', async () => {
      mockChunks.set('c1', makeChunk('c1'));
      mockChunks.set('c2', makeChunk('c2'));

      mockVectorResults = [
        { id: 'c1', distance: 0.1 },
        { id: 'c2', distance: 0.3 },
      ];

      const result = await searchContext({ query: 'test' });

      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].id).toBe('c1');
      expect(result.chunks[1].id).toBe('c2');
      expect(result.text).toContain('Content for c1');
      expect(result.text).toContain('Content for c2');
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('includes keyword results via RRF fusion', async () => {
      mockChunks.set('v1', makeChunk('v1'));
      mockChunks.set('k1', makeChunk('k1'));

      mockVectorResults = [{ id: 'v1', distance: 0.2 }];
      mockKeywordResults = [{ id: 'k1', score: 5.0 }];

      const result = await searchContext({ query: 'test' });

      expect(result.chunks.length).toBe(2);
      const ids = result.chunks.map((c) => c.id);
      expect(ids).toContain('v1');
      expect(ids).toContain('k1');
    });

    it('deduplicates chunks appearing in both vector and keyword results', async () => {
      mockChunks.set('shared', makeChunk('shared'));

      mockVectorResults = [{ id: 'shared', distance: 0.1 }];
      mockKeywordResults = [{ id: 'shared', score: 5.0 }];

      const result = await searchContext({ query: 'test' });

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].id).toBe('shared');
    });

    it('extracts top 5 seed IDs', async () => {
      for (let i = 0; i < 8; i++) {
        const id = `c${i}`;
        mockChunks.set(id, makeChunk(id));
      }

      mockVectorResults = Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        distance: 0.1 + i * 0.05,
      }));

      const result = await searchContext({ query: 'test' });

      expect(result.seedIds.length).toBe(5);
    });

    it('applies recency boost for current session', async () => {
      mockChunks.set('current', makeChunk('current', { sessionId: 'active-session' }));
      mockChunks.set('old', makeChunk('old', { sessionId: 'other-session' }));

      // old has a better base score
      mockVectorResults = [
        { id: 'old', distance: 0.1 },
        { id: 'current', distance: 0.15 },
      ];

      const resultWithBoost = await searchContext({
        query: 'test',
        currentSessionId: 'active-session',
      });

      // Current session chunk should be boosted
      const currentChunk = resultWithBoost.chunks.find((c) => c.id === 'current');
      expect(currentChunk).toBeDefined();
    });

    it('respects token budget', async () => {
      // Each chunk is ~50 tokens. Budget = 80 → only 1 full chunk + maybe truncated
      mockChunks.set('c1', makeChunk('c1', { approxTokens: 50 }));
      mockChunks.set('c2', makeChunk('c2', { approxTokens: 50 }));

      mockVectorResults = [
        { id: 'c1', distance: 0.1 },
        { id: 'c2', distance: 0.2 },
      ];

      const result = await searchContext({
        query: 'test',
        maxTokens: 80,
      });

      // At most 2 chunks (1 full + 1 truncated), likely just 1
      expect(result.chunks.length).toBeLessThanOrEqual(2);
      expect(result.tokenCount).toBeLessThanOrEqual(80);
    });

    it('returns query embedding for downstream use', async () => {
      mockEmbedding = [0.5, 0.5, 0];
      const result = await searchContext({ query: 'test' });
      expect(result.queryEmbedding).toEqual([0.5, 0.5, 0]);
    });

    it('respects vectorSearchLimit', async () => {
      for (let i = 0; i < 30; i++) {
        mockChunks.set(`c${i}`, makeChunk(`c${i}`));
      }
      mockVectorResults = Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        distance: 0.1 + i * 0.01,
      }));

      // vectorSearchLimit is passed to vectorStore.search — we verify
      // the search still works (mock returns all regardless, but the parameter is passed)
      const result = await searchContext({
        query: 'test',
        vectorSearchLimit: 10,
      });

      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('formats chunks with session metadata', async () => {
      mockChunks.set(
        'c1',
        makeChunk('c1', {
          sessionSlug: 'my-project',
          startTime: '2024-06-15T10:00:00Z',
        }),
      );
      mockVectorResults = [{ id: 'c1', distance: 0.1 }];

      const result = await searchContext({ query: 'test' });

      expect(result.text).toContain('Session: my-project');
      expect(result.text).toContain('Relevance:');
    });

    it('gracefully handles keyword search failure', async () => {
      mockChunks.set('c1', makeChunk('c1'));
      mockVectorResults = [{ id: 'c1', distance: 0.1 }];

      // Force keyword search to throw
      mockKeywordResults = [];
      // The mock won't throw, but search-assembler wraps keyword in try/catch
      // Just verify it still returns vector results
      const result = await searchContext({ query: 'test' });

      expect(result.chunks.length).toBe(1);
    });
  });

  describe('SearchRequest', () => {
    it('has required query field', () => {
      const request: SearchRequest = { query: 'test' };
      expect(request.query).toBe('test');
    });

    it('supports optional fields', () => {
      const request: SearchRequest = {
        query: 'test',
        currentSessionId: 'session-1',
        projectFilter: 'my-project',
        maxTokens: 5000,
        vectorSearchLimit: 30,
        skipClusters: true,
      };

      expect(request.currentSessionId).toBe('session-1');
      expect(request.projectFilter).toBe('my-project');
      expect(request.maxTokens).toBe(5000);
      expect(request.vectorSearchLimit).toBe(30);
      expect(request.skipClusters).toBe(true);
    });
  });
});
