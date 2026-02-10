/**
 * Maintenance task: Remove expired orphaned vectors (TTL-based).
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface CleanupVectorsDeps {
  cleanupExpired: (ttlDays: number) => Promise<number>;
  ttlDays: number;
}

export async function cleanupVectors(deps: CleanupVectorsDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const deletedCount = await deps.cleanupExpired(deps.ttlDays);

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Cleaned up ${deletedCount} expired orphaned vectors`,
      details: { deletedCount, ttlDays: deps.ttlDays },
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Vector cleanup failed: ${(error as Error).message}`,
    };
  }
}
