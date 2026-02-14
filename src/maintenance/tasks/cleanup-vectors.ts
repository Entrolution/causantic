/**
 * Maintenance task: Remove expired vectors (TTL-based) and enforce FIFO cap.
 */

import type { MaintenanceResult } from '../scheduler.js';

export interface CleanupVectorsDeps {
  cleanupExpired: (ttlDays: number) => Promise<number>;
  evictOldest: (maxCount: number) => Promise<number>;
  ttlDays: number;
  maxCount: number;
}

export async function cleanupVectors(deps: CleanupVectorsDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const expiredCount = await deps.cleanupExpired(deps.ttlDays);
    const evictedCount = await deps.evictOldest(deps.maxCount);
    const totalDeleted = expiredCount + evictedCount;

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Cleaned up ${totalDeleted} vectors (${expiredCount} expired, ${evictedCount} evicted by FIFO cap)`,
      details: { expiredCount, evictedCount, ttlDays: deps.ttlDays, maxCount: deps.maxCount },
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Vector cleanup failed: ${(error as Error).message}`,
    };
  }
}
