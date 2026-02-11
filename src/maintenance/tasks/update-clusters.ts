/**
 * Maintenance task: Re-run HDBSCAN clustering on all embeddings,
 * then refresh cluster labels via Haiku if an API key is available.
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface UpdateClustersDeps {
  recluster: () => Promise<unknown>;
  refreshLabels?: () => Promise<unknown[]>;
}

export async function updateClusters(deps: UpdateClustersDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    await deps.recluster();

    let labelsRefreshed = 0;
    if (deps.refreshLabels) {
      try {
        const results = await deps.refreshLabels();
        labelsRefreshed = results.length;
      } catch {
        // No API key or label refresh failed — not a fatal error
      }
    }

    const message = labelsRefreshed > 0
      ? `Clusters updated, ${labelsRefreshed} labels refreshed`
      : 'Clusters updated successfully';

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
