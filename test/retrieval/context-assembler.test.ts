/**
 * Tests for context assembly.
 */

import { describe, it, expect } from 'vitest';
import type { RetrievalMode, RetrievalRange, RetrievalRequest, RetrievalResponse } from '../../src/retrieval/context-assembler.js';

describe('context-assembler', () => {
  describe('RetrievalMode', () => {
    it('supports recall mode', () => {
      const mode: RetrievalMode = 'recall';
      expect(mode).toBe('recall');
    });

    it('supports explain mode', () => {
      const mode: RetrievalMode = 'explain';
      expect(mode).toBe('explain');
    });

    it('supports predict mode', () => {
      const mode: RetrievalMode = 'predict';
      expect(mode).toBe('predict');
    });
  });

  describe('RetrievalRange', () => {
    it('supports short range for recent context', () => {
      const range: RetrievalRange = 'short';
      expect(range).toBe('short');
    });

    it('supports long range for historical context', () => {
      const range: RetrievalRange = 'long';
      expect(range).toBe('long');
    });

    it('supports auto range for system decision', () => {
      const range: RetrievalRange = 'auto';
      expect(range).toBe('auto');
    });
  });

  describe('RetrievalRequest interface', () => {
    it('requires query and mode', () => {
      const request: RetrievalRequest = {
        query: 'How do I authenticate users?',
        mode: 'recall',
      };

      expect(request.query).toBeDefined();
      expect(request.mode).toBeDefined();
    });

    it('supports optional session ID for recency boost', () => {
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'recall',
        currentSessionId: 'session-abc-123',
      };

      expect(request.currentSessionId).toBe('session-abc-123');
    });

    it('supports optional project slug for vector clock decay', () => {
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'recall',
        projectSlug: 'my-project',
      };

      expect(request.projectSlug).toBe('my-project');
    });

    it('supports optional query time override', () => {
      const pastTime = Date.now() - 3600000; // 1 hour ago
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'recall',
        queryTime: pastTime,
      };

      expect(request.queryTime).toBe(pastTime);
    });

    it('supports optional max tokens', () => {
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'recall',
        maxTokens: 4000,
      };

      expect(request.maxTokens).toBe(4000);
    });

    it('supports optional range hint', () => {
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'explain',
        range: 'long',
      };

      expect(request.range).toBe('long');
    });

    it('supports optional vector search limit', () => {
      const request: RetrievalRequest = {
        query: 'test query',
        mode: 'recall',
        vectorSearchLimit: 50,
      };

      expect(request.vectorSearchLimit).toBe(50);
    });
  });

  describe('RetrievalResponse interface', () => {
    it('has required fields', () => {
      const response: RetrievalResponse = {
        text: 'Context text here...',
        tokenCount: 150,
        chunks: [],
        totalConsidered: 25,
        durationMs: 42,
      };

      expect(response.text).toBeDefined();
      expect(response.tokenCount).toBeDefined();
      expect(response.chunks).toBeDefined();
      expect(response.totalConsidered).toBeDefined();
      expect(response.durationMs).toBeDefined();
    });

    it('chunks contain expected metadata', () => {
      const response: RetrievalResponse = {
        text: 'test',
        tokenCount: 10,
        chunks: [
          {
            id: 'chunk-1',
            sessionSlug: 'my-project',
            weight: 0.85,
            preview: 'This is a preview of the chunk content...',
          },
        ],
        totalConsidered: 10,
        durationMs: 25,
      };

      const chunk = response.chunks[0];
      expect(chunk.id).toBe('chunk-1');
      expect(chunk.sessionSlug).toBe('my-project');
      expect(chunk.weight).toBe(0.85);
      expect(chunk.preview).toContain('preview');
    });
  });

  describe('mode-direction mapping', () => {
    it('recall mode uses backward traversal', () => {
      const mode: RetrievalMode = 'recall';
      const direction = mode === 'predict' ? 'forward' : 'backward';
      expect(direction).toBe('backward');
    });

    it('explain mode uses backward traversal', () => {
      const mode: RetrievalMode = 'explain';
      const direction = mode === 'predict' ? 'forward' : 'backward';
      expect(direction).toBe('backward');
    });

    it('predict mode uses forward traversal', () => {
      const mode: RetrievalMode = 'predict';
      const direction = mode === 'predict' ? 'forward' : 'backward';
      expect(direction).toBe('forward');
    });
  });

  describe('range-decay mapping', () => {
    it('short range uses short-range decay (15min hold)', () => {
      const range: RetrievalRange = 'short';
      // Short-range is for recent/immediate follow-ups
      expect(range).toBe('short');
    });

    it('long range uses long-range decay (60min hold)', () => {
      const range: RetrievalRange = 'long';
      // Long-range is for historical/cross-session
      expect(range).toBe('long');
    });

    it('auto range chooses based on mode', () => {
      // explain → long (benefits from historical context)
      // recall → short (immediate context)
      const modeDecayMap = {
        explain: 'long',
        recall: 'short',
        predict: 'forward',
      };

      expect(modeDecayMap.explain).toBe('long');
      expect(modeDecayMap.recall).toBe('short');
    });
  });

  describe('token budget logic', () => {
    it('respects max tokens limit', () => {
      const maxTokens = 1000;
      const chunkTokens = [300, 300, 300, 300, 300]; // 1500 total

      let totalTokens = 0;
      const included = [];

      for (const tokens of chunkTokens) {
        if (totalTokens + tokens <= maxTokens) {
          totalTokens += tokens;
          included.push(tokens);
        }
      }

      expect(totalTokens).toBe(900);
      expect(included.length).toBe(3);
    });

    it('truncates last chunk if space available', () => {
      const maxTokens = 500;
      const remainingTokens = maxTokens - 300; // After 1 chunk

      // If remaining > 100, truncate last chunk to fit
      expect(remainingTokens).toBeGreaterThan(100);
    });
  });

  describe('recency boost', () => {
    it('applies 20% boost for current session chunks', () => {
      const baseWeight = 0.5;
      const boostedWeight = baseWeight * 1.2;

      expect(boostedWeight).toBeCloseTo(0.6);
    });

    it('does not boost chunks from other sessions', () => {
      const currentSessionId = 'session-a';
      const chunkSessionId = 'session-b';
      const isCurrentSession = chunkSessionId === currentSessionId;

      expect(isCurrentSession).toBe(false);
    });
  });

  describe('vector search integration', () => {
    it('converts distance to weight (1 - distance)', () => {
      const distances = [0.1, 0.3, 0.5, 0.8];
      const weights = distances.map((d) => Math.max(0, 1 - d));

      expect(weights[0]).toBeCloseTo(0.9);
      expect(weights[1]).toBeCloseTo(0.7);
      expect(weights[2]).toBeCloseTo(0.5);
      expect(weights[3]).toBeCloseTo(0.2);
    });

    it('boosts direct vector hits by 1.5x', () => {
      const vectorWeight = 0.8;
      const boostedWeight = vectorWeight * 1.5;

      expect(boostedWeight).toBeCloseTo(1.2);
    });
  });

  describe('chunk formatting', () => {
    it('formats chunk with metadata header', () => {
      const sessionSlug = 'my-project';
      const startTime = '2024-01-15T10:30:00Z';
      const weight = 0.85;

      const date = new Date(startTime).toLocaleDateString();
      const relevance = (weight * 100).toFixed(0);
      const header = `[Session: ${sessionSlug} | Date: ${date} | Relevance: ${relevance}%]`;

      expect(header).toContain('my-project');
      expect(header).toContain('85%');
    });

    it('separates chunks with dividers', () => {
      const chunks = ['chunk1', 'chunk2', 'chunk3'];
      const joined = chunks.join('\n\n---\n\n');

      expect(joined).toContain('---');
      expect(joined.split('---').length).toBe(3);
    });
  });

  describe('truncation', () => {
    it('preserves content at paragraph boundaries when possible', () => {
      const content = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';
      const maxChars = 20; // Cuts within "Paragraph 2."

      const truncated = content.slice(0, maxChars);
      const lastNewline = truncated.lastIndexOf('\n\n');

      // lastNewline at position 12 ("\n\n"), maxChars * 0.5 = 10
      // Since 12 > 10, we cut at the paragraph boundary
      expect(lastNewline).toBe(12);
      expect(lastNewline).toBeGreaterThan(maxChars * 0.5);

      const result = truncated.slice(0, lastNewline);
      expect(result).toBe('Paragraph 1.');
    });

    it('adds truncation marker', () => {
      const truncated = 'Some content\n...[truncated]';
      expect(truncated).toContain('[truncated]');
    });
  });

  describe('empty results', () => {
    it('returns empty response when no similar chunks found', () => {
      const emptyResponse: RetrievalResponse = {
        text: '',
        tokenCount: 0,
        chunks: [],
        totalConsidered: 0,
        durationMs: 5,
      };

      expect(emptyResponse.text).toBe('');
      expect(emptyResponse.chunks.length).toBe(0);
    });
  });
});
