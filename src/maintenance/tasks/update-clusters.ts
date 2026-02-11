/**
 * Maintenance task: Re-run HDBSCAN clustering on all embeddings,
 * then refresh cluster labels via Haiku if an API key is available.
 */

import type { MaintenanceResult } from '../scheduler.js';
import type { ClusteringResult } from '../../clusters/cluster-manager.js';

export interface UpdateClustersDeps {
  recluster: () => Promise<ClusteringResult>;
  refreshLabels?: () => Promise<unknown[]>;
}

export async function updateClusters(deps: UpdateClustersDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const result = await deps.recluster();

    let labelsRefreshed = 0;
    if (deps.refreshLabels) {
      try {
        const results = await deps.refreshLabels();
        labelsRefreshed = results.length;
      } catch {
        // No API key or label refresh failed — not a fatal error
      }
    }

    const parts = [`${result.numClusters} clusters, ${result.assignedChunks} assigned`];
    if (result.reassignedNoise > 0) {
      parts.push(`${result.reassignedNoise} noise points rescued`);
    }
    if (labelsRefreshed > 0) {
      parts.push(`${labelsRefreshed} labels refreshed`);
    }
    const message = parts.join(', ');

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
