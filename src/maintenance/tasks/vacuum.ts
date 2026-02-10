/**
 * Maintenance task: Optimize SQLite database.
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import type { MaintenanceResult } from '../scheduler.js';

export interface VacuumDeps {
  getDb: () => Database.Database;
}

export async function vacuum(deps: VacuumDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const db = deps.getDb();
    db.exec('VACUUM');

    return {
      success: true,
      duration: Date.now() - startTime,
      message: 'Database vacuumed successfully',
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Vacuum failed: ${(error as Error).message}`,
    };
  }
}
