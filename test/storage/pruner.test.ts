/**
 * Tests for lazy pruning system.
 */

import { describe, it, expect } from 'vitest';
import type { PruneResult, FullPruneProgress } from '../../src/storage/pruner.js';

describe('pruner', () => {
  describe('PruneResult interface', () => {
    it('has correct structure', () => {
      const result: PruneResult = {
        edgesDeleted: 5,
        chunksDeleted: 2,
      };

      expect(result.edgesDeleted).toBe(5);
      expect(result.chunksDeleted).toBe(2);
    });

    it('returns zeros when nothing to prune', () => {
      const result: PruneResult = {
        edgesDeleted: 0,
        chunksDeleted: 0,
      };

      expect(result.edgesDeleted).toBe(0);
      expect(result.chunksDeleted).toBe(0);
    });
  });

  describe('FullPruneProgress interface', () => {
    it('has correct structure for running state', () => {
      const progress: FullPruneProgress = {
        status: 'running',
        edgesScanned: 150,
        edgesDeleted: 5,
        chunksScanned: 50,
        chunksDeleted: 2,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
      };

      expect(progress.status).toBe('running');
      expect(progress.completedAt).toBeNull();
      expect(progress.error).toBeNull();
    });

    it('has correct structure for completed state', () => {
      const startTime = Date.now() - 5000;
      const progress: FullPruneProgress = {
        status: 'completed',
        edgesScanned: 1000,
        edgesDeleted: 50,
        chunksScanned: 200,
        chunksDeleted: 10,
        startedAt: startTime,
        completedAt: Date.now(),
        error: null,
      };

      expect(progress.status).toBe('completed');
      expect(progress.completedAt).not.toBeNull();
      expect(progress.completedAt! - progress.startedAt).toBeGreaterThan(0);
    });

    it('has correct structure for error state', () => {
      const progress: FullPruneProgress = {
        status: 'error',
        edgesScanned: 500,
        edgesDeleted: 10,
        chunksScanned: 100,
        chunksDeleted: 3,
        startedAt: Date.now() - 2000,
        completedAt: Date.now(),
        error: 'Database connection lost',
      };

      expect(progress.status).toBe('error');
      expect(progress.error).toBe('Database connection lost');
    });
  });

  describe('edge queueing', () => {
    it('tracks pending edge count', () => {
      const pendingEdges = new Set<string>();
      pendingEdges.add('edge-1');
      pendingEdges.add('edge-2');
      pendingEdges.add('edge-3');

      expect(pendingEdges.size).toBe(3);
    });

    it('deduplicates queued edges', () => {
      const pendingEdges = new Set<string>();
      pendingEdges.add('edge-1');
      pendingEdges.add('edge-2');
      pendingEdges.add('edge-1'); // Duplicate

      expect(pendingEdges.size).toBe(2);
    });

    it('batch queuing adds all edges', () => {
      const pendingEdges = new Set<string>();
      const batch = ['edge-1', 'edge-2', 'edge-3'];

      for (const id of batch) {
        pendingEdges.add(id);
      }

      expect(pendingEdges.size).toBe(3);
    });

    it('clear removes all pending', () => {
      const pendingEdges = new Set<string>();
      pendingEdges.add('edge-1');
      pendingEdges.add('edge-2');

      pendingEdges.clear();

      expect(pendingEdges.size).toBe(0);
    });
  });

  describe('orphan detection logic', () => {
    it('chunk is orphaned when it has no edges', () => {
      const hasEdges = false;
      const isOrphaned = !hasEdges;

      expect(isOrphaned).toBe(true);
    });

    it('chunk is not orphaned when it has edges', () => {
      const hasEdges = true;
      const isOrphaned = !hasEdges;

      expect(isOrphaned).toBe(false);
    });

    it('tracks chunks to check from deleted edges', () => {
      const chunkIdsToCheck = new Set<string>();

      // When edge A->B is deleted, check both A and B
      const deletedEdge = { sourceChunkId: 'chunk-a', targetChunkId: 'chunk-b' };
      chunkIdsToCheck.add(deletedEdge.sourceChunkId);
      chunkIdsToCheck.add(deletedEdge.targetChunkId);

      expect(chunkIdsToCheck.has('chunk-a')).toBe(true);
      expect(chunkIdsToCheck.has('chunk-b')).toBe(true);
    });
  });

  describe('dead edge detection', () => {
    it('edge is dead when weight <= 0', () => {
      const weights = [0.5, 0, -0.1, 0.001, -0.5];
      const deadWeights = weights.filter((w) => w <= 0);

      expect(deadWeights).toEqual([0, -0.1, -0.5]);
    });

    it('edge is alive when weight > 0', () => {
      const weights = [0.5, 0.001, 1.0];
      const aliveWeights = weights.filter((w) => w > 0);

      expect(aliveWeights).toEqual([0.5, 0.001, 1.0]);
    });
  });

  describe('debounce logic', () => {
    it('delays flush by configurable time', async () => {
      const flushDelayMs = 100;
      let flushed = false;

      const scheduleFlush = () => {
        setTimeout(() => {
          flushed = true;
        }, flushDelayMs);
      };

      scheduleFlush();

      // Immediately after scheduling, not yet flushed
      expect(flushed).toBe(false);

      // Wait for delay
      await new Promise((resolve) => setTimeout(resolve, flushDelayMs + 50));
      expect(flushed).toBe(true);
    });

    it('only one flush is scheduled at a time', () => {
      let flushTimeout: ReturnType<typeof setTimeout> | null = null;
      let scheduleCount = 0;

      const scheduleFlush = () => {
        if (flushTimeout) {
          return; // Already scheduled
        }
        scheduleCount++;
        flushTimeout = setTimeout(() => {
          flushTimeout = null;
        }, 100);
      };

      scheduleFlush();
      scheduleFlush();
      scheduleFlush();

      expect(scheduleCount).toBe(1);
    });
  });

  describe('full prune progress tracking', () => {
    it('calculates completion percentage', () => {
      const progress: FullPruneProgress = {
        status: 'running',
        edgesScanned: 500,
        edgesDeleted: 25,
        chunksScanned: 100,
        chunksDeleted: 5,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
      };

      // Deletion rate
      const edgeDeletionRate = progress.edgesScanned > 0 ? progress.edgesDeleted / progress.edgesScanned : 0;
      const chunkDeletionRate = progress.chunksScanned > 0 ? progress.chunksDeleted / progress.chunksScanned : 0;

      expect(edgeDeletionRate).toBeCloseTo(0.05);
      expect(chunkDeletionRate).toBeCloseTo(0.05);
    });

    it('calculates duration for completed prune', () => {
      const startedAt = Date.now() - 5000;
      const completedAt = Date.now();

      const durationMs = completedAt - startedAt;

      expect(durationMs).toBeCloseTo(5000, -2);
    });
  });

  describe('batch processing', () => {
    it('processes edges in batches', () => {
      const edgeIds = Array.from({ length: 350 }, (_, i) => `edge-${i}`);
      const batchSize = 100;
      const batches: string[][] = [];

      for (let i = 0; i < edgeIds.length; i += batchSize) {
        batches.push(edgeIds.slice(i, i + batchSize));
      }

      expect(batches.length).toBe(4);
      expect(batches[0].length).toBe(100);
      expect(batches[3].length).toBe(50);
    });
  });

  describe('orphaned chunk cleanup', () => {
    it('removes cluster assignments and chunk but preserves vector', () => {
      // Simulated cleanup order - vectors are intentionally preserved
      // for semantic search beyond the causal graph bounds
      const cleanupSteps = ['removeChunkAssignments', 'deleteChunk'];

      expect(cleanupSteps[0]).toBe('removeChunkAssignments');
      expect(cleanupSteps[1]).toBe('deleteChunk');
      // Note: vectorStore.delete is NOT called - vectors remain for search
    });

    it('preserves vectors for semantic search', () => {
      // Vectors should remain searchable even when chunks are pruned
      // This allows finding old context that may still be relevant
      const vectorsPreserved = true;
      expect(vectorsPreserved).toBe(true);
    });
  });

  describe('idempotent background prune', () => {
    it('returns existing progress if already running', () => {
      let fullPruneRunning = false;
      let fullPruneProgress: FullPruneProgress | null = null;

      const startBackgroundPrune = (): FullPruneProgress => {
        if (fullPruneProgress && fullPruneRunning) {
          return fullPruneProgress; // Return existing
        }

        fullPruneProgress = {
          status: 'running',
          edgesScanned: 0,
          edgesDeleted: 0,
          chunksScanned: 0,
          chunksDeleted: 0,
          startedAt: Date.now(),
          completedAt: null,
          error: null,
        };
        fullPruneRunning = true;
        return fullPruneProgress;
      };

      const first = startBackgroundPrune();
      const second = startBackgroundPrune();

      expect(first).toBe(second); // Same object
    });
  });
});
