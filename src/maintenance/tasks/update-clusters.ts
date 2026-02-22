/**
 * Maintenance task: Re-run HDBSCAN clustering on all embeddings,
 * then refresh cluster labels via Haiku if an API key is available.
 *
 * Supports incremental assignment when a persisted HDBSCAN model exists,
 * falling back to full recluster when threshold is exceeded or no model is available.
 */

import type { MaintenanceResult } from '../types.js';
import type { ClusteringResult } from '../../clusters/cluster-manager.js';

export interface UpdateClustersDeps {
  recluster: () => Promise<ClusteringResult>;
  incrementalAssign?: (newChunkIds: string[]) => Promise<{
    assigned: number;
    noise: number;
    usedFullRecluster: boolean;
  }>;
  getNewChunkIds?: () => string[];
  refreshLabels?: () => Promise<unknown[]>;
}

export async function updateClusters(deps: UpdateClustersDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    let message: string;

    // Try incremental assignment if new chunks are available
    const newChunkIds = deps.getNewChunkIds?.() ?? [];
    if (newChunkIds.length > 0 && deps.incrementalAssign) {
      const incResult = await deps.incrementalAssign(newChunkIds);

      if (incResult.usedFullRecluster) {
        // incrementalAssign fell back to full recluster
        message = `Full recluster (threshold exceeded or no model), ${incResult.assigned} assigned`;
      } else {
        message = `Incremental: ${incResult.assigned} assigned, ${incResult.noise} noise`;
      }
    } else {
      // No incremental support or no new chunks — full recluster
      const result = await deps.recluster();

      const parts = [`${result.numClusters} clusters, ${result.assignedChunks} assigned`];
      if (result.reassignedNoise > 0) {
        parts.push(`${result.reassignedNoise} noise points rescued`);
      }
      message = parts.join(', ');
    }

    let labelsRefreshed = 0;
    if (deps.refreshLabels) {
      try {
        const results = await deps.refreshLabels();
        labelsRefreshed = results.length;
      } catch {
        // No API key or label refresh failed — not a fatal error
      }
    }

    if (labelsRefreshed > 0) {
      message += `, ${labelsRefreshed} labels refreshed`;
    }

    return {
      success: true,
      duration: Date.now() - startTime,
      message,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Clustering failed: ${(error as Error).message}`,
    };
  }
}
