/**
 * Maintenance task: Remove dead edges and mark orphaned chunks for TTL cleanup.
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface PruneGraphDeps {
  flushNow: () => Promise<{ edgesDeleted: number; chunksOrphaned: number }>;
}

export async function pruneGraph(deps: PruneGraphDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const result = await deps.flushNow();

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Pruned ${result.edgesDeleted} edges, marked ${result.chunksOrphaned} chunks for TTL cleanup`,
      details: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Pruning failed: ${(error as Error).message}`,
    };
  }
}
