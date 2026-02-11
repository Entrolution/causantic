/**
 * Lazy pruning system for dead edges.
 * Edges with weight <= 0 at query time are queued for async deletion.
 * Chunks that lose all edges are marked for TTL-based cleanup (not deleted).
 *
 * Two pruning modes:
 * 1. Lazy: Queued during traversal, flushed after debounce
 * 2. Full: Background scan on startup, removes all dead edges
 *
 * Chunks remain in the database after losing edges so they can still be
 * found via vector and keyword search. Their vectors are marked orphaned
 * to start the TTL countdown; the cleanup-vectors task handles eventual
 * deletion of both vector and chunk after TTL expires.
 */

import { deleteEdge, hasAnyEdges, getAllEdges } from './edge-store.js';
import { vectorStore } from './vector-store.js';
import { getReferenceClock } from './clock-store.js';
import { calculateDirectionalDecayWeight, type EdgeDirection } from './decay.js';
import { deserialize } from '../temporal/vector-clock.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pruner');

/**
 * Pruner class for managing lazy deletion of dead edges.
 * Chunks that lose all edges are marked for TTL cleanup, not deleted.
 */
class Pruner {
  private pendingEdges: Set<string> = new Set();
  private isRunning = false;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private flushDelayMs = 1000;

  /**
   * Queue an edge for pruning.
   * Called during edge traversal when weight <= 0.
   */
  queueEdgePrune(edgeId: string): void {
    this.pendingEdges.add(edgeId);
    this.scheduleFlush();
  }

  /**
   * Queue multiple edges for pruning.
   */
  queueEdgePruneBatch(edgeIds: string[]): void {
    for (const id of edgeIds) {
      this.pendingEdges.add(id);
    }
    this.scheduleFlush();
  }

  /**
   * Get count of pending edges.
   */
  getPendingCount(): number {
    return this.pendingEdges.size;
  }

  /**
   * Force immediate flush (for testing or shutdown).
   */
  async flushNow(): Promise<PruneResult> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    return this.flush();
  }

  /**
   * Schedule a debounced flush.
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      return; // Already scheduled
    }

    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush().catch((err) => {
        log.error('Pruner flush error', { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.flushDelayMs);
  }

  /**
   * Execute the pruning operation.
   */
  private async flush(): Promise<PruneResult> {
    if (this.isRunning || this.pendingEdges.size === 0) {
      return { edgesDeleted: 0, chunksOrphaned: 0 };
    }

    this.isRunning = true;
    const result: PruneResult = { edgesDeleted: 0, chunksOrphaned: 0 };

    try {
      const edgeIds = [...this.pendingEdges];
      this.pendingEdges.clear();

      // Track chunks that might lose all edges
      const chunkIdsToCheck = new Set<string>();

      for (const edgeId of edgeIds) {
        // Get edge info before deleting (we need source/target)
        const { getEdgeById } = await import('./edge-store.js');
        const edge = getEdgeById(edgeId);

        if (!edge) {
          continue; // Already deleted
        }

        // Delete the edge
        const deleted = deleteEdge(edgeId);
        if (deleted) {
          result.edgesDeleted++;
          chunkIdsToCheck.add(edge.sourceChunkId);
          chunkIdsToCheck.add(edge.targetChunkId);
        }
      }

      // Mark chunks that lost all edges for TTL cleanup
      for (const chunkId of chunkIdsToCheck) {
        if (!hasAnyEdges(chunkId)) {
          await vectorStore.markOrphaned(chunkId);
          result.chunksOrphaned++;
        }
      }
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  /**
   * Set flush delay (for testing).
   */
  setFlushDelay(ms: number): void {
    this.flushDelayMs = ms;
  }

  /**
   * Check if pruner is currently running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Clear pending queue without flushing (for testing).
   */
  clearPending(): void {
    this.pendingEdges.clear();
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }

  // ─── Full Background Prune ────────────────────────────────────────

  private fullPruneRunning = false;
  private fullPruneProgress: FullPruneProgress | null = null;

  /**
   * Start a full background prune (non-blocking).
   * Scans all edges, removes dead ones, marks orphaned chunks for TTL.
   * Idempotent - if already running, returns existing progress.
   */
  startBackgroundPrune(): FullPruneProgress {
    if (this.fullPruneProgress && this.fullPruneRunning) {
      return this.fullPruneProgress;
    }

    this.fullPruneProgress = {
      status: 'running',
      edgesScanned: 0,
      edgesDeleted: 0,
      chunksScanned: 0,
      chunksOrphaned: 0,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };

    // Run in background - don't await
    this.runFullPrune().catch((err) => {
      if (this.fullPruneProgress) {
        this.fullPruneProgress.status = 'error';
        this.fullPruneProgress.error = err.message;
        this.fullPruneProgress.completedAt = Date.now();
      }
      log.error('Full prune error', { error: err instanceof Error ? err.message : String(err) });
    });

    return this.fullPruneProgress;
  }

  /**
   * Get current full prune progress (null if never started).
   */
  getFullPruneProgress(): FullPruneProgress | null {
    return this.fullPruneProgress;
  }

  /**
   * Check if full prune is currently running.
   */
  isFullPruneRunning(): boolean {
    return this.fullPruneRunning;
  }

  /**
   * Run the full prune operation.
   * Scans all edges, calculates weights, removes dead edges, and marks
   * chunks that lose all edges for TTL cleanup.
   */
  private async runFullPrune(): Promise<void> {
    if (this.fullPruneRunning) {
      return;
    }

    this.fullPruneRunning = true;
    const progress = this.fullPruneProgress!;

    try {
      // Build reference clocks for all projects
      const refClocks = new Map<string, Record<string, number>>();

      // Get all edges
      const edges = getAllEdges();
      const deadEdgeIds: string[] = [];
      const chunkIdsToCheck = new Set<string>();

      // Scan edges and identify dead ones
      for (const edge of edges) {
        progress.edgesScanned++;

        // Get reference clock for this edge's project (lazy load)
        let refClock = refClocks.get(edge.sourceChunkId);
        if (!refClock) {
          // Try to get from chunk's session
          const { getChunkById } = await import('./chunk-store.js');
          const chunk = getChunkById(edge.sourceChunkId);
          if (chunk) {
            refClock = getReferenceClock(chunk.sessionSlug);
            refClocks.set(edge.sourceChunkId, refClock);
          }
        }

        // Calculate weight
        let weight = edge.initialWeight;
        if (refClock && edge.vectorClock) {
          const edgeClock = deserialize(edge.vectorClock);
          const direction: EdgeDirection = edge.edgeType === 'forward' ? 'forward' : 'backward';
          weight = edge.initialWeight * calculateDirectionalDecayWeight(edgeClock, refClock, direction);
        }

        // Queue dead edges
        if (weight <= 0) {
          deadEdgeIds.push(edge.id);
          chunkIdsToCheck.add(edge.sourceChunkId);
          chunkIdsToCheck.add(edge.targetChunkId);
        }

        // Yield periodically to avoid blocking
        if (progress.edgesScanned % 500 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      // Delete dead edges in batches
      const batchSize = 100;
      for (let i = 0; i < deadEdgeIds.length; i += batchSize) {
        const batch = deadEdgeIds.slice(i, i + batchSize);
        for (const edgeId of batch) {
          if (deleteEdge(edgeId)) {
            progress.edgesDeleted++;
          }
        }
        // Yield after each batch
        await new Promise((resolve) => setImmediate(resolve));
      }

      // Mark chunks that lost all edges for TTL cleanup
      for (const chunkId of chunkIdsToCheck) {
        progress.chunksScanned++;

        if (!hasAnyEdges(chunkId)) {
          await vectorStore.markOrphaned(chunkId);
          progress.chunksOrphaned++;
        }

        // Yield periodically
        if (progress.chunksScanned % 100 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      progress.status = 'completed';
      progress.completedAt = Date.now();
    } finally {
      this.fullPruneRunning = false;
    }
  }
}

/**
 * Result of a prune operation.
 */
export interface PruneResult {
  edgesDeleted: number;
  chunksOrphaned: number;
}

/**
 * Progress of a full background prune.
 */
export interface FullPruneProgress {
  status: 'running' | 'completed' | 'error';
  edgesScanned: number;
  edgesDeleted: number;
  chunksScanned: number;
  chunksOrphaned: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

// Export class for testing (allows creating fresh instances)
export { Pruner };

// Singleton instance for production use
export const pruner = new Pruner();

/**
 * Start background pruning on module load if environment variable is set.
 * This allows the MCP server or CLI to trigger startup pruning.
 */
export function initStartupPrune(): FullPruneProgress {
  return pruner.startBackgroundPrune();
}
