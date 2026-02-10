/**
 * Maintenance task: Remove dead edges and orphan nodes.
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface PruneGraphDeps {
  flushNow: () => Promise<{ edgesDeleted: number; chunksDeleted: number }>;
}

export async function pruneGraph(deps: PruneGraphDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const result = await deps.flushNow();

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Pruned ${result.edgesDeleted} edges, ${result.chunksDeleted} chunks`,
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
