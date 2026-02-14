/**
 * Maintenance task: Discover new sessions and ingest changes.
 */

import { existsSync } from 'node:fs';
import type { MaintenanceResult } from '../types.js';

export interface ScanProjectsDeps {
  batchIngest: (dirs: string[], opts: Record<string, unknown>) => Promise<{ successCount: number }>;
  claudeProjectsPath: string;
}

export async function scanProjects(deps: ScanProjectsDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    if (!existsSync(deps.claudeProjectsPath)) {
      return {
        success: true,
        duration: Date.now() - startTime,
        message: 'No Claude projects directory found',
      };
    }

    const result = await deps.batchIngest([deps.claudeProjectsPath], {});

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Scanned projects: ${result.successCount} sessions processed`,
      details: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Scan failed: ${(error as Error).message}`,
    };
  }
}
