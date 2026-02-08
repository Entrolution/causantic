/**
 * Lazy pruning system for dead edges and orphaned nodes.
 * Edges with weight <= 0 at query time are queued for async deletion.
 * Orphaned nodes (no remaining edges) are also removed.
 *
 * Two pruning modes:
 * 1. Lazy: Queued during traversal, flushed after debounce
 * 2. Full: Background scan on startup, removes all dead edges/nodes
 */

import { deleteEdge, hasAnyEdges, getAllEdges } from './edge-store.js';
import { deleteChunk, getAllChunks } from './chunk-store.js';
import { removeChunkAssignments } from './cluster-store.js';
import { vectorStore } from './vector-store.js';
import { getReferenceClock } from './clock-store.js';
import { calculateDirectionalDecayWeight, type EdgeDirection } from './decay.js';
import { deserialize } from '../temporal/vector-clock.js';

/**
 * Pruner class for managing lazy deletion of dead edges and orphaned chunks.
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
        console.error('Pruner flush error:', err);
      });
    }, this.flushDelayMs);
  }

  /**
   * Execute the pruning operation.
   */
  private async flush(): Promise<PruneResult> {
    if (this.isRunning || this.pendingEdges.size === 0) {
      return { edgesDeleted: 0, chunksDeleted: 0 };
    }

    this.isRunning = true;
    const result: PruneResult = { edgesDeleted: 0, chunksDeleted: 0 };

    try {
      const edgeIds = [...this.pendingEdges];
      this.pendingEdges.clear();

      // Track chunks that might become orphaned
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

      // Check for orphaned chunks
      for (const chunkId of chunkIdsToCheck) {
        const hasEdges = hasAnyEdges(chunkId);
        if (!hasEdges) {
          // Chunk is orphaned - remove it
          await this.deleteOrphanedChunk(chunkId);
          result.chunksDeleted++;
        }
      }
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  /**
   * Delete an orphaned chunk and its associated data.
   */
  private async deleteOrphanedChunk(chunkId: string): Promise<void> {
    // Remove cluster assignments
    removeChunkAssignments(chunkId);

    // Remove vector
    await vectorStore.delete(chunkId);

    // Remove chunk
    deleteChunk(chunkId);
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
   * Scans all edges, removes dead ones, then removes orphan chunks.
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
      chunksDeleted: 0,
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
      console.error('Full prune error:', err);
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
   * Scans all edges, calculates weights, removes dead edges and orphan chunks.
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

      // Check for orphan chunks
      for (const chunkId of chunkIdsToCheck) {
        progress.chunksScanned++;

        if (!hasAnyEdges(chunkId)) {
          await this.deleteOrphanedChunk(chunkId);
          progress.chunksDeleted++;
        }

        // Yield periodically
        if (progress.chunksScanned % 100 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      // Also scan for any chunks that have no edges at all (orphans from before)
      const allChunks = getAllChunks();
      for (const chunk of allChunks) {
        if (!chunkIdsToCheck.has(chunk.id)) {
          progress.chunksScanned++;

          if (!hasAnyEdges(chunk.id)) {
            await this.deleteOrphanedChunk(chunk.id);
            progress.chunksDeleted++;
          }

          // Yield periodically
          if (progress.chunksScanned % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
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
  chunksDeleted: number;
}

/**
 * Progress of a full background prune.
 */
export interface FullPruneProgress {
  status: 'running' | 'completed' | 'error';
  edgesScanned: number;
  edgesDeleted: number;
  chunksScanned: number;
  chunksDeleted: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

// Singleton instance
export const pruner = new Pruner();

/**
 * Start background pruning on module load if environment variable is set.
 * This allows the MCP server or CLI to trigger startup pruning.
 */
export function initStartupPrune(): FullPruneProgress {
  return pruner.startBackgroundPrune();
}
