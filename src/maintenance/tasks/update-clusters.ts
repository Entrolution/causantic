/**
 * Maintenance task: Re-run HDBSCAN clustering on all embeddings.
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface UpdateClustersDeps {
  recluster: () => Promise<unknown>;
}

export async function updateClusters(deps: UpdateClustersDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    await deps.recluster();

    return {
      success: true,
      duration: Date.now() - startTime,
      message: 'Clusters updated successfully',
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Clustering failed: ${(error as Error).message}`,
    };
  }
}
