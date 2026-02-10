/**
 * Tests for pre-compact hook handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ingest/ingest-session.js', () => ({
  ingestSession: vi.fn(),
}));

vi.mock('../../src/clusters/cluster-manager.js', () => ({
  clusterManager: {
    assignNewChunks: vi.fn(),
  },
}));

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {
    getAllVectors: vi.fn(),
  },
}));

vi.mock('../../src/hooks/hook-utils.js', () => ({
  executeHook: vi.fn(async (_name: string, fn: () => Promise<unknown>, _opts?: unknown) => {
    const result = await fn();
    return { result, metrics: { durationMs: 10 } };
  }),
  logHook: vi.fn(),
  isTransientError: vi.fn(() => false),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { handlePreCompact } from '../../src/hooks/pre-compact.js';
import { ingestSession } from '../../src/ingest/ingest-session.js';
import { clusterManager } from '../../src/clusters/cluster-manager.js';
import { vectorStore } from '../../src/storage/vector-store.js';

const mockedIngestSession = vi.mocked(ingestSession);
const mockedAssignNewChunks = vi.mocked(clusterManager.assignNewChunks);
const mockedGetAllVectors = vi.mocked(vectorStore.getAllVectors);

describe('pre-compact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePreCompact', () => {
    it('returns skipped result when session already ingested', async () => {
      mockedIngestSession.mockResolvedValue({
        sessionId: 'sess-123',
        sessionSlug: 'my-project',
        chunkCount: 0,
        edgeCount: 0,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: true,
        skipReason: 'already_ingested',
        durationMs: 5,
        subAgentCount: 0,
      });

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.skipped).toBe(true);
      expect(result.sessionId).toBe('sess-123');
      expect(result.chunkCount).toBe(0);
      expect(result.edgeCount).toBe(0);
      expect(result.clustersAssigned).toBe(0);

      expect(mockedIngestSession).toHaveBeenCalledWith('/path/to/session.jsonl', {
        skipIfExists: true,
        linkCrossSessions: true,
      });
      expect(mockedGetAllVectors).not.toHaveBeenCalled();
      expect(mockedAssignNewChunks).not.toHaveBeenCalled();
    });

    it('returns result with chunk/edge counts on successful ingestion', async () => {
      mockedIngestSession.mockResolvedValue({
        sessionId: 'sess-456',
        sessionSlug: 'my-project',
        chunkCount: 5,
        edgeCount: 3,
        crossSessionEdges: 1,
        subAgentEdges: 0,
        skipped: false,
        durationMs: 50,
        subAgentCount: 0,
      });

      const fakeVectors = [
        { id: 'c1', embedding: [0.1, 0.2] },
        { id: 'c2', embedding: [0.3, 0.4] },
        { id: 'c3', embedding: [0.5, 0.6] },
        { id: 'c4', embedding: [0.7, 0.8] },
        { id: 'c5', embedding: [0.9, 1.0] },
      ];
      mockedGetAllVectors.mockResolvedValue(fakeVectors);
      mockedAssignNewChunks.mockResolvedValue({ assigned: 3, total: 5 });

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.skipped).toBe(false);
      expect(result.sessionId).toBe('sess-456');
      expect(result.chunkCount).toBe(5);
      expect(result.edgeCount).toBe(3);
      expect(result.clustersAssigned).toBe(3);
    });

    it('handles cluster assignment failure gracefully', async () => {
      mockedIngestSession.mockResolvedValue({
        sessionId: 'sess-789',
        sessionSlug: 'my-project',
        chunkCount: 2,
        edgeCount: 1,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: false,
        durationMs: 30,
        subAgentCount: 0,
      });

      mockedGetAllVectors.mockResolvedValue([
        { id: 'c1', embedding: [0.1] },
        { id: 'c2', embedding: [0.2] },
      ]);
      mockedAssignNewChunks.mockRejectedValue(new Error('Cluster DB locked'));

      const result = await handlePreCompact('/path/to/session.jsonl');

      // Should succeed despite cluster failure
      expect(result.skipped).toBe(false);
      expect(result.sessionId).toBe('sess-789');
      expect(result.chunkCount).toBe(2);
      expect(result.edgeCount).toBe(1);
      // Clusters assignment failed, so count stays 0
      expect(result.clustersAssigned).toBe(0);
    });

    it('returns result with clustersAssigned count on success', async () => {
      mockedIngestSession.mockResolvedValue({
        sessionId: 'sess-abc',
        sessionSlug: 'my-project',
        chunkCount: 10,
        edgeCount: 8,
        crossSessionEdges: 2,
        subAgentEdges: 1,
        skipped: false,
        durationMs: 100,
        subAgentCount: 1,
      });

      // Return 15 vectors total, last 10 are the new ones
      const allVectors = Array.from({ length: 15 }, (_, i) => ({
        id: `chunk-${i}`,
        embedding: [i * 0.1],
      }));
      mockedGetAllVectors.mockResolvedValue(allVectors);
      mockedAssignNewChunks.mockResolvedValue({ assigned: 7, total: 10 });

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.clustersAssigned).toBe(7);
      expect(result.chunkCount).toBe(10);
      expect(result.edgeCount).toBe(8);
      expect(result.skipped).toBe(false);

      // Verify assignNewChunks received the last 10 vectors (matching chunkCount)
      expect(mockedAssignNewChunks).toHaveBeenCalledWith(allVectors.slice(-10));
    });

    it('does not attempt cluster assignment when chunkCount is 0 but not skipped', async () => {
      mockedIngestSession.mockResolvedValue({
        sessionId: 'sess-empty',
        sessionSlug: 'my-project',
        chunkCount: 0,
        edgeCount: 0,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: false,
        durationMs: 10,
        subAgentCount: 0,
      });

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.skipped).toBe(false);
      expect(result.chunkCount).toBe(0);
      expect(result.clustersAssigned).toBe(0);
      expect(mockedGetAllVectors).not.toHaveBeenCalled();
      expect(mockedAssignNewChunks).not.toHaveBeenCalled();
    });
  });
});
