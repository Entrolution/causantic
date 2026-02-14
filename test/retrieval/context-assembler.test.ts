/**
 * Tests for context assembler (facade over search-assembler and chain-assembler).
 *
 * The context-assembler delegates to:
 * - searchContext() for assembleContext()
 * - recallContext() for recall()
 * - predictContext() for predict()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResponse } from '../../src/retrieval/search-assembler.js';
import type { EpisodicResponse } from '../../src/retrieval/chain-assembler.js';

// --- Mock responses ---

let mockSearchResponse: SearchResponse = {
  text: 'Search result text',
  tokenCount: 100,
  chunks: [
    { id: 'c1', sessionSlug: 'test', weight: 0.9, preview: 'Preview 1', source: 'vector' },
  ],
  totalConsidered: 5,
  durationMs: 25,
  queryEmbedding: [1, 0, 0],
  seedIds: ['c1'],
};

let mockRecallResponse: EpisodicResponse = {
  text: 'Recall chain',
  tokenCount: 200,
  chunks: [
    { id: 'r1', sessionSlug: 'test', weight: 0.8, preview: 'Recall chunk' },
  ],
  mode: 'chain',
  chainLength: 3,
  durationMs: 50,
};

let mockPredictResponse: EpisodicResponse = {
  text: 'Predict chain',
  tokenCount: 150,
  chunks: [
    { id: 'p1', sessionSlug: 'test', weight: 0.7, preview: 'Predict chunk' },
  ],
  mode: 'chain',
  chainLength: 2,
  durationMs: 40,
};

vi.mock('../../src/retrieval/search-assembler.js', () => ({
  searchContext: async () => mockSearchResponse,
  disposeSearch: vi.fn(),
}));

vi.mock('../../src/retrieval/chain-assembler.js', () => ({
  recallContext: async () => mockRecallResponse,
  predictContext: async () => mockPredictResponse,
}));

// --- Tests ---

import {
  assembleContext,
  recall,
  predict,
  disposeRetrieval,
  type RetrievalRequest,
  type RetrievalResponse,
} from '../../src/retrieval/context-assembler.js';

describe('context-assembler', () => {
  beforeEach(() => {
    mockSearchResponse = {
      text: 'Search result text',
      tokenCount: 100,
      chunks: [
        { id: 'c1', sessionSlug: 'test', weight: 0.9, preview: 'Preview 1', source: 'vector' },
      ],
      totalConsidered: 5,
      durationMs: 25,
      queryEmbedding: [1, 0, 0],
      seedIds: ['c1'],
    };

    mockRecallResponse = {
      text: 'Recall chain',
      tokenCount: 200,
      chunks: [
        { id: 'r1', sessionSlug: 'test', weight: 0.8, preview: 'Recall chunk' },
      ],
      mode: 'chain',
      chainLength: 3,
      durationMs: 50,
    };

    mockPredictResponse = {
      text: 'Predict chain',
      tokenCount: 150,
      chunks: [
        { id: 'p1', sessionSlug: 'test', weight: 0.7, preview: 'Predict chunk' },
      ],
      mode: 'chain',
      chainLength: 2,
      durationMs: 40,
    };
  });

  describe('assembleContext', () => {
    it('delegates to searchContext', async () => {
      const result = await assembleContext({
        query: 'test query',
        mode: 'search',
      });

      expect(result.text).toBe('Search result text');
      expect(result.tokenCount).toBe(100);
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].id).toBe('c1');
      expect(result.totalConsidered).toBe(5);
      expect(result.durationMs).toBe(25);
    });

    it('passes options through to searchContext', async () => {
      const result = await assembleContext({
        query: 'auth bug',
        mode: 'search',
        currentSessionId: 'session-5',
        projectFilter: 'my-project',
        maxTokens: 5000,
        vectorSearchLimit: 10,
      });

      expect(result).toBeDefined();
    });
  });

  describe('recall', () => {
    it('delegates to recallContext', async () => {
      const result = await recall('auth bug');

      expect(result.text).toBe('Recall chain');
      expect(result.tokenCount).toBe(200);
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].id).toBe('r1');
      expect(result.totalConsidered).toBe(1); // chunks.length
      expect(result.durationMs).toBe(50);
    });

    it('passes options through', async () => {
      const result = await recall('query', {
        currentSessionId: 'session-1',
        projectFilter: 'proj',
        maxTokens: 3000,
      });

      expect(result).toBeDefined();
    });
  });

  describe('predict', () => {
    it('delegates to predictContext', async () => {
      const result = await predict('current context');

      expect(result.text).toBe('Predict chain');
      expect(result.tokenCount).toBe(150);
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].id).toBe('p1');
      expect(result.totalConsidered).toBe(1); // chunks.length
      expect(result.durationMs).toBe(40);
    });

    it('passes options through', async () => {
      const result = await predict('context', {
        projectFilter: ['proj-a', 'proj-b'],
        maxTokens: 8000,
      });

      expect(result).toBeDefined();
    });
  });

  describe('disposeRetrieval', () => {
    it('can be called without error', async () => {
      await expect(disposeRetrieval()).resolves.not.toThrow();
    });
  });

  describe('RetrievalRequest interface', () => {
    it('supports recall mode', () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'recall',
      };
      expect(request.mode).toBe('recall');
    });

    it('supports predict mode', () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'predict',
      };
      expect(request.mode).toBe('predict');
    });

    it('supports search mode', () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'search',
      };
      expect(request.mode).toBe('search');
    });

    it('supports optional projectFilter as string', () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'recall',
        projectFilter: 'my-project',
      };
      expect(request.projectFilter).toBe('my-project');
    });

    it('supports optional projectFilter as array', () => {
      const request: RetrievalRequest = {
        query: 'test',
        mode: 'recall',
        projectFilter: ['project-a', 'project-b'],
      };
      expect(request.projectFilter).toEqual(['project-a', 'project-b']);
    });
  });

  describe('RetrievalResponse interface', () => {
    it('has required fields', () => {
      const response: RetrievalResponse = {
        text: 'Context text',
        tokenCount: 100,
        chunks: [],
        totalConsidered: 5,
        durationMs: 30,
      };

      expect(response.text).toBeDefined();
      expect(response.tokenCount).toBeDefined();
      expect(response.chunks).toBeDefined();
      expect(response.totalConsidered).toBeDefined();
      expect(response.durationMs).toBeDefined();
    });

    it('chunks support source field', () => {
      const response: RetrievalResponse = {
        text: 'test',
        tokenCount: 10,
        chunks: [
          { id: 'c1', sessionSlug: 'proj', weight: 0.9, preview: 'text', source: 'vector' },
          { id: 'c2', sessionSlug: 'proj', weight: 0.7, preview: 'text', source: 'keyword' },
          { id: 'c3', sessionSlug: 'proj', weight: 0.5, preview: 'text', source: 'cluster' },
        ],
        totalConsidered: 10,
        durationMs: 20,
      };

      expect(response.chunks[0].source).toBe('vector');
      expect(response.chunks[1].source).toBe('keyword');
      expect(response.chunks[2].source).toBe('cluster');
    });
  });
});
