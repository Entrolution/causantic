/**
 * Maintenance task: Update cluster descriptions via Haiku (optional, requires API key).
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface RefreshLabelsDeps {
  refreshAllClusters: (opts: Record<string, unknown>) => Promise<unknown[]>;
}

export async function refreshLabels(deps: RefreshLabelsDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const results = await deps.refreshAllClusters({});

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Refreshed ${results.length} cluster labels`,
      details: { results } as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    if (errorMessage.includes('API key')) {
      return {
        success: false,
        duration: Date.now() - startTime,
        message: 'Skipped: No Anthropic API key configured',
      };
    }
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Label refresh failed: ${errorMessage}`,
    };
  }
}
