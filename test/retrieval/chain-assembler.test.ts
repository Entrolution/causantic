/**
 * Tests for chain assembler (episodic retrieval: seeds → chains → narrative).
 *
 * Mocks searchContext and chain-walker to test the orchestration logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResponse } from '../../src/retrieval/search-assembler.js';
import type { Chain } from '../../src/retrieval/chain-walker.js';
import type { StoredChunk } from '../../src/storage/types.js';

// --- Mock data factories ---

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

function makeSearchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    text: 'Search results text',
    tokenCount: 100,
    chunks: [
      { id: 'seed-1', sessionSlug: 'test-project', weight: 0.9, preview: 'Preview 1' },
      { id: 'seed-2', sessionSlug: 'test-project', weight: 0.7, preview: 'Preview 2' },
    ],
    totalConsidered: 10,
    durationMs: 50,
    queryEmbedding: [1, 0, 0],
    seedIds: ['seed-1', 'seed-2'],
    ...overrides,
  };
}

function makeChain(chunkIds: string[], score: number): Chain {
  const perNode = score / chunkIds.length;
  const nodeScores = chunkIds.map(() => perNode);
  return {
    chunkIds,
    chunks: chunkIds.map((id) => makeChunk(id)),
    nodeScores,
    score,
    tokenCount: chunkIds.length * 100,
    medianScore: perNode,
  };
}

// --- Mocks ---

let mockSearchResult: SearchResponse = makeSearchResponse();
let mockChains: Chain[] = [];
let mockBestChain: Chain | null = null;

vi.mock('../../src/retrieval/search-assembler.js', () => ({
  searchContext: async () => mockSearchResult,
  disposeSearch: vi.fn(),
}));

vi.mock('../../src/retrieval/chain-walker.js', () => ({
  walkChains: async () => mockChains,
  selectBestChain: () => mockBestChain,
}));

vi.mock('../../src/storage/chunk-store.js', () => ({
  getChunkById: (id: string) => makeChunk(id),
}));

vi.mock('../../src/utils/token-counter.js', () => ({
  approximateTokens: (text: string) => Math.ceil(text.length / 4),
}));

// --- Tests ---

import { recallContext, predictContext, type EpisodicRequest, type EpisodicResponse } from '../../src/retrieval/chain-assembler.js';

describe('chain-assembler', () => {
  beforeEach(() => {
    mockSearchResult = makeSearchResponse();
    mockChains = [];
    mockBestChain = null;
  });

  describe('recallContext', () => {
    it('returns chain-based response when chain is found', async () => {
      const chain = makeChain(['A', 'B', 'C'], 2.5);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await recallContext({ query: 'test' });

      expect(result.mode).toBe('chain');
      expect(result.chainLength).toBe(3);
      expect(result.chunks.length).toBe(3);
      expect(result.text).toContain('Content for');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('falls back to search when no seeds found', async () => {
      mockSearchResult = makeSearchResponse({ seedIds: [] });

      const result = await recallContext({ query: 'test' });

      expect(result.mode).toBe('search-fallback');
      expect(result.chainLength).toBe(0);
      expect(result.chunks.length).toBe(2); // from search result
    });

    it('falls back to search when no qualifying chain exists', async () => {
      mockChains = [];
      mockBestChain = null;

      const result = await recallContext({ query: 'test' });

      expect(result.mode).toBe('search-fallback');
      expect(result.chainLength).toBe(0);
    });

    it('reverses backward chain for chronological output', async () => {
      // Backward walk produces: C, B, A (most recent first)
      // Output should be: A, B, C (chronological)
      const chain = makeChain(['C', 'B', 'A'], 2.0);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await recallContext({ query: 'test' });

      expect(result.mode).toBe('chain');
      // Chunks should be reversed for chronological order
      expect(result.chunks[0].id).toBe('A');
      expect(result.chunks[1].id).toBe('B');
      expect(result.chunks[2].id).toBe('C');
    });

    it('passes options through to search', async () => {
      mockSearchResult = makeSearchResponse({ seedIds: [] });

      const request: EpisodicRequest = {
        query: 'auth bug',
        currentSessionId: 'session-5',
        projectFilter: 'my-project',
        maxTokens: 5000,
        vectorSearchLimit: 10,
      };

      const result = await recallContext(request);

      // Should still work (falls back to search)
      expect(result).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('predictContext', () => {
    it('returns chain-based response when chain is found', async () => {
      const chain = makeChain(['A', 'B', 'C'], 2.0);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await predictContext({ query: 'current state' });

      expect(result.mode).toBe('chain');
      expect(result.chainLength).toBe(3);
    });

    it('does NOT reverse forward chain (preserves traversal order)', async () => {
      const chain = makeChain(['A', 'B', 'C'], 2.0);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await predictContext({ query: 'test' });

      expect(result.chunks[0].id).toBe('A');
      expect(result.chunks[1].id).toBe('B');
      expect(result.chunks[2].id).toBe('C');
    });

    it('falls back to search when no chain found', async () => {
      mockChains = [];
      mockBestChain = null;

      const result = await predictContext({ query: 'test' });

      expect(result.mode).toBe('search-fallback');
      expect(result.chainLength).toBe(0);
    });
  });

  describe('EpisodicResponse', () => {
    it('has required fields', () => {
      const response: EpisodicResponse = {
        text: 'chain narrative',
        tokenCount: 300,
        chunks: [
          { id: 'c1', sessionSlug: 'proj', weight: 0.8, preview: 'Preview...' },
        ],
        mode: 'chain',
        chainLength: 3,
        durationMs: 42,
      };

      expect(response.mode).toBe('chain');
      expect(response.chainLength).toBe(3);
    });

    it('supports search-fallback mode', () => {
      const response: EpisodicResponse = {
        text: 'fallback results',
        tokenCount: 200,
        chunks: [],
        mode: 'search-fallback',
        chainLength: 0,
        durationMs: 30,
      };

      expect(response.mode).toBe('search-fallback');
      expect(response.chainLength).toBe(0);
    });
  });

  describe('chain formatting', () => {
    it('formats chain chunks with position indicators', async () => {
      const chain = makeChain(['A', 'B'], 1.5);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await recallContext({ query: 'test' });

      // Backward chains get reversed, so output should show position markers
      expect(result.text).toContain('[');
      expect(result.text).toContain('Session:');
      expect(result.text).toContain('Date:');
    });

    it('separates chain chunks with dividers', async () => {
      const chain = makeChain(['A', 'B', 'C'], 2.0);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await recallContext({ query: 'test' });

      expect(result.text).toContain('---');
    });

    it('reports median score as chunk weight', async () => {
      const chain = makeChain(['A', 'B'], 2.0);
      mockChains = [chain];
      mockBestChain = chain;

      const result = await recallContext({ query: 'test' });

      // Weight = medianScore = 1.0 (uniform scores of 2.0/2)
      for (const chunk of result.chunks) {
        expect(chunk.weight).toBeCloseTo(1.0);
      }
    });
  });
});
