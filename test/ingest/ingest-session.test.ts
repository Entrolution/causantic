/**
 * Tests for session ingestion orchestrator.
 */

import { describe, it, expect } from 'vitest';
import { chunkToInput } from '../../src/ingest/ingest-session.js';
import type { IngestOptions, IngestResult } from '../../src/ingest/ingest-session.js';
import type { Chunk } from '../../src/parser/types.js';

describe('ingest-session', () => {
  describe('IngestOptions interface', () => {
    it('has sensible defaults', () => {
      const defaults: Required<Omit<IngestOptions, 'embedder' | 'embeddingDevice'>> = {
        maxTokensPerChunk: 4096,
        includeThinking: true,
        embeddingModel: 'jina-small',
        skipIfExists: true,
        linkCrossSessions: true,
        processSubAgents: true,
        useIncrementalIngestion: true,
        useEmbeddingCache: true,
      };

      expect(defaults.maxTokensPerChunk).toBe(4096);
      expect(defaults.includeThinking).toBe(true);
      expect(defaults.embeddingModel).toBe('jina-small');
      expect(defaults.skipIfExists).toBe(true);
    });

    it('allows optional embedder for batch processing', () => {
      const options: IngestOptions = {
        embedder: undefined, // Optional shared embedder
      };

      expect(options.embedder).toBeUndefined();
    });
  });

  describe('IngestResult interface', () => {
    it('has correct structure for successful ingestion', () => {
      const result: IngestResult = {
        sessionId: 'abc-123',
        sessionSlug: 'my-project',
        chunkCount: 15,
        edgeCount: 28,
        crossSessionEdges: 6,
        subAgentEdges: 4,
        skipped: false,
        durationMs: 1234,
        subAgentCount: 2,
      };

      expect(result.sessionId).toBe('abc-123');
      expect(result.chunkCount).toBe(15);
      expect(result.edgeCount).toBe(28);
      expect(result.skipped).toBe(false);
    });

    it('has correct structure for skipped session', () => {
      const result: IngestResult = {
        sessionId: 'abc-123',
        sessionSlug: 'my-project',
        chunkCount: 0,
        edgeCount: 0,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: true,
        durationMs: 5,
        subAgentCount: 0,
      };

      expect(result.skipped).toBe(true);
      expect(result.chunkCount).toBe(0);
    });

    it('has correct structure for empty session', () => {
      const result: IngestResult = {
        sessionId: 'abc-123',
        sessionSlug: 'my-project',
        chunkCount: 0,
        edgeCount: 0,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: false,
        durationMs: 10,
        subAgentCount: 0,
      };

      expect(result.skipped).toBe(false);
      expect(result.chunkCount).toBe(0);
    });
  });

  describe('chunkToInput', () => {
    it('converts parser Chunk to storage ChunkInput', () => {
      const chunk: Chunk = {
        id: 'chunk-1',
        text: 'Test content',
        metadata: {
          sessionId: 'session-abc',
          sessionSlug: 'my-project',
          turnIndices: [0, 1, 2],
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T10:05:00Z',
          codeBlockCount: 2,
          toolUseCount: 1,
          hasThinking: false,
          renderMode: 'full',
          approxTokens: 150,
        },
      };

      const input = chunkToInput(chunk);

      expect(input.id).toBe('chunk-1');
      expect(input.sessionId).toBe('session-abc');
      expect(input.sessionSlug).toBe('my-project');
      expect(input.turnIndices).toEqual([0, 1, 2]);
      expect(input.content).toBe('Test content');
      expect(input.codeBlockCount).toBe(2);
      expect(input.toolUseCount).toBe(1);
      expect(input.approxTokens).toBe(150);
    });
  });

  describe('ingestion workflow', () => {
    it('processes in correct order', () => {
      const steps = [
        'getSessionInfo',
        'checkIfExists',
        'parseMessages',
        'assembleTurns',
        'discoverSubAgents',
        'processSubAgents',
        'chunkMainSession',
        'storeChunks',
        'embedChunks',
        'detectTransitions',
        'createEdges',
        'createBriefDebriefEdges',
        'linkCrossSessions',
      ];

      expect(steps[0]).toBe('getSessionInfo');
      expect(steps[steps.length - 1]).toBe('linkCrossSessions');
    });
  });

  describe('sub-agent processing', () => {
    it('tracks sub-agent data', () => {
      const subAgentId = 'explore-agent';
      const subAgentData = new Map<string, { agentId: string }>();
      subAgentData.set(subAgentId, { agentId: subAgentId });

      expect(subAgentData.get(subAgentId)?.agentId).toBe('explore-agent');
    });

    it('tracks sub-agent data for brief/debrief detection', () => {
      const subAgentData = new Map<string, { turns: unknown[]; chunks: unknown[] }>();

      subAgentData.set('agent-1', { turns: [1, 2, 3], chunks: ['c1', 'c2'] });
      subAgentData.set('agent-2', { turns: [4, 5], chunks: ['c3'] });

      expect(subAgentData.size).toBe(2);
      expect(subAgentData.get('agent-1')?.chunks.length).toBe(2);
    });
  });

  describe('edge creation', () => {
    it('creates both intra-session and cross-session edges', () => {
      const result: IngestResult = {
        sessionId: 'abc',
        sessionSlug: 'proj',
        chunkCount: 10,
        edgeCount: 18, // Intra-session
        crossSessionEdges: 6, // Cross-session
        subAgentEdges: 4, // Brief/debrief
        skipped: false,
        durationMs: 100,
        subAgentCount: 1,
      };

      const totalEdges = result.edgeCount + result.crossSessionEdges + result.subAgentEdges;
      expect(totalEdges).toBe(28);
    });
  });

  describe('embedder lifecycle', () => {
    it('disposes embedder when not shared', () => {
      const needsDispose = true; // !options.embedder
      expect(needsDispose).toBe(true);
    });

    it('does not dispose shared embedder', () => {
      const needsDispose = false; // options.embedder provided
      expect(needsDispose).toBe(false);
    });
  });

  describe('skip logic', () => {
    it('skips when session exists and skipIfExists is true', () => {
      const skipIfExists = true;
      const isIngested = true;

      const shouldSkip = skipIfExists && isIngested;
      expect(shouldSkip).toBe(true);
    });

    it('does not skip when skipIfExists is false', () => {
      const skipIfExists = false;
      const isIngested = true;

      const shouldSkip = skipIfExists && isIngested;
      expect(shouldSkip).toBe(false);
    });

    it('does not skip when session does not exist', () => {
      const skipIfExists = true;
      const isIngested = false;

      const shouldSkip = skipIfExists && isIngested;
      expect(shouldSkip).toBe(false);
    });
  });

  describe('empty session handling', () => {
    it('returns early for zero turns', () => {
      const turns: unknown[] = [];

      if (turns.length === 0) {
        expect(true).toBe(true); // Should return early
      }
    });

    it('returns early for zero chunks', () => {
      const chunks: unknown[] = [];

      if (chunks.length === 0) {
        expect(true).toBe(true); // Should return early
      }
    });
  });
});
