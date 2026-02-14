/**
 * Shared types for the maintenance module.
 *
 * Extracted from scheduler.ts so task handlers can import types
 * without creating circular dependencies with the scheduler.
 */

/** Cron-style schedule expression */
export type CronSchedule = string;

/** Result of a maintenance task run */
export interface MaintenanceResult {
  success: boolean;
  duration: number;
  message: string;
  details?: Record<string, unknown>;
}

/** Maintenance task definition */
export interface MaintenanceTask {
  name: string;
  description: string;
  schedule: CronSchedule;
  requiresApiKey: boolean;
  handler: () => Promise<MaintenanceResult>;
}

/** Task run record */
export interface TaskRun {
  taskName: string;
  startTime: string;
  endTime: string;
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}
