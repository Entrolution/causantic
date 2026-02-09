/**
 * Maintenance task scheduler for ECM.
 *
 * Manages periodic maintenance tasks:
 * - scan-projects: Discover and ingest new sessions
 * - update-clusters: Re-run HDBSCAN clustering
 * - prune-graph: Remove dead edges and orphan nodes
 * - refresh-labels: Update cluster descriptions (optional, requires API key)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { resolvePath } from '../config/memory-config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduler');

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

/** Scheduler state */
interface SchedulerState {
  lastRuns: Record<string, TaskRun>;
  version: string;
}

const STATE_FILE_PATH = '~/.ecm/maintenance-state.json';
const STATE_VERSION = '1.0';

/**
 * Parse a cron schedule and check if it should run now.
 * Simplified cron: "minute hour dayOfMonth month dayOfWeek"
 * Supports * for wildcards and specific values.
 */
function shouldRunNow(schedule: CronSchedule, lastRun: Date | null): boolean {
  const now = new Date();
  const parts = schedule.split(' ');

  if (parts.length !== 5) {
    log.warn(`Invalid cron schedule: ${schedule}`);
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Check if the current time matches the schedule
  const matches = (field: string, value: number, max: number): boolean => {
    if (field === '*') return true;
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return value % parseInt(step, 10) === 0;
    }
    return parseInt(field, 10) === value;
  };

  const minuteMatch = matches(minute, now.getMinutes(), 59);
  const hourMatch = matches(hour, now.getHours(), 23);
  const dayOfMonthMatch = matches(dayOfMonth, now.getDate(), 31);
  const monthMatch = matches(month, now.getMonth() + 1, 12);
  const dayOfWeekMatch = matches(dayOfWeek, now.getDay(), 6);

  if (!minuteMatch || !hourMatch || !dayOfMonthMatch || !monthMatch || !dayOfWeekMatch) {
    return false;
  }

  // Don't run if already run this minute
  if (lastRun) {
    const lastRunMinute = Math.floor(lastRun.getTime() / 60000);
    const currentMinute = Math.floor(now.getTime() / 60000);
    if (lastRunMinute === currentMinute) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate next run time for a cron schedule.
 */
function getNextRunTime(schedule: CronSchedule): Date | null {
  const parts = schedule.split(' ');
  if (parts.length !== 5) return null;

  const [minute, hour] = parts;
  const now = new Date();
  const next = new Date(now);

  // Simple case: specific hour and minute
  if (minute !== '*' && hour !== '*') {
    next.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // For wildcards, return approximate next run
  if (hour === '*') {
    next.setMinutes(parseInt(minute === '*' ? '0' : minute, 10), 0, 0);
    if (next <= now) {
      next.setHours(next.getHours() + 1);
    }
    return next;
  }

  return null;
}

/**
 * Load scheduler state from disk.
 */
function loadState(): SchedulerState {
  const statePath = resolvePath(STATE_FILE_PATH);

  if (!existsSync(statePath)) {
    return { lastRuns: {}, version: STATE_VERSION };
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content) as SchedulerState;
    return state;
  } catch {
    return { lastRuns: {}, version: STATE_VERSION };
  }
}

/**
 * Save scheduler state to disk.
 */
function saveState(state: SchedulerState): void {
  const statePath = resolvePath(STATE_FILE_PATH);
  const dir = dirname(statePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Record a task run in the state.
 */
function recordRun(taskName: string, result: MaintenanceResult, startTime: Date): void {
  const state = loadState();

  state.lastRuns[taskName] = {
    taskName,
    startTime: startTime.toISOString(),
    endTime: new Date().toISOString(),
    success: result.success,
    message: result.message,
    details: result.details,
  };

  saveState(state);
}

/**
 * Placeholder task handlers - these call into the actual implementation modules.
 */
async function scanProjectsHandler(): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    // Import and run the batch ingestion
    const { batchIngest } = await import('../ingest/batch-ingest.js');
    const claudeProjectsPath = resolvePath('~/.claude/projects');

    if (!existsSync(claudeProjectsPath)) {
      return {
        success: true,
        duration: Date.now() - startTime,
        message: 'No Claude projects directory found',
      };
    }

    const result = await batchIngest([claudeProjectsPath], {});

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

async function updateClustersHandler(): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const { clusterManager } = await import('../clusters/cluster-manager.js');
    await clusterManager.recluster();

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

async function pruneGraphHandler(): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const { pruner } = await import('../storage/pruner.js');
    const result = await pruner.flushNow();

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Pruned ${result.edgesDeleted} edges, ${result.chunksDeleted} chunks`,
      details: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Pruning failed: ${(error as Error).message}`,
    };
  }
}

async function refreshLabelsHandler(): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const { clusterRefresher } = await import('../clusters/cluster-refresh.js');
    const results = await clusterRefresher.refreshAllClusters({});

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

async function vacuumHandler(): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const { getDb } = await import('../storage/db.js');
    const db = getDb();
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

/**
 * Available maintenance tasks.
 */
export const MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    name: 'scan-projects',
    description: 'Discover new sessions and ingest changes',
    schedule: '0 * * * *', // Every hour
    requiresApiKey: false,
    handler: scanProjectsHandler,
  },
  {
    name: 'update-clusters',
    description: 'Re-run HDBSCAN clustering on all embeddings',
    schedule: '0 2 * * *', // Daily at 2am
    requiresApiKey: false,
    handler: updateClustersHandler,
  },
  {
    name: 'prune-graph',
    description: 'Remove dead edges and orphan nodes',
    schedule: '0 3 * * *', // Daily at 3am
    requiresApiKey: false,
    handler: pruneGraphHandler,
  },
  {
    name: 'refresh-labels',
    description: 'Update cluster descriptions via Haiku (optional)',
    schedule: '0 4 * * 0', // Weekly on Sunday at 4am
    requiresApiKey: true,
    handler: refreshLabelsHandler,
  },
  {
    name: 'vacuum',
    description: 'Optimize SQLite database',
    schedule: '0 5 * * 0', // Weekly on Sunday at 5am
    requiresApiKey: false,
    handler: vacuumHandler,
  },
];

/**
 * Get a task by name.
 */
export function getTask(name: string): MaintenanceTask | undefined {
  return MAINTENANCE_TASKS.find((t) => t.name === name);
}

/**
 * Run a specific maintenance task.
 */
export async function runTask(name: string): Promise<MaintenanceResult> {
  const task = getTask(name);

  if (!task) {
    return {
      success: false,
      duration: 0,
      message: `Unknown task: ${name}`,
    };
  }

  log.info(`Running maintenance task: ${task.name}`);
  const startTime = new Date();

  try {
    const result = await task.handler();
    recordRun(task.name, result, startTime);
    log.info(`Task ${task.name}: ${result.message}`, { durationMs: result.duration });
    return result;
  } catch (error) {
    const result: MaintenanceResult = {
      success: false,
      duration: Date.now() - startTime.getTime(),
      message: `Task failed: ${(error as Error).message}`,
    };
    recordRun(task.name, result, startTime);
    log.error(`Task ${task.name} failed`, { error: (error as Error).message });
    return result;
  }
}

/**
 * Run all maintenance tasks.
 */
export async function runAllTasks(): Promise<Map<string, MaintenanceResult>> {
  const results = new Map<string, MaintenanceResult>();

  for (const task of MAINTENANCE_TASKS) {
    const result = await runTask(task.name);
    results.set(task.name, result);
  }

  return results;
}

/**
 * Get status of all maintenance tasks.
 */
export function getStatus(): Array<{
  name: string;
  description: string;
  schedule: string;
  lastRun: TaskRun | null;
  nextRun: Date | null;
}> {
  const state = loadState();

  return MAINTENANCE_TASKS.map((task) => ({
    name: task.name,
    description: task.description,
    schedule: task.schedule,
    lastRun: state.lastRuns[task.name] ?? null,
    nextRun: getNextRunTime(task.schedule),
  }));
}

/**
 * Run the scheduler daemon.
 * Checks every minute for tasks that should run.
 */
export async function runDaemon(signal?: AbortSignal): Promise<void> {
  log.info('Starting maintenance daemon...');

  const checkAndRun = async (): Promise<void> => {
    const state = loadState();

    for (const task of MAINTENANCE_TASKS) {
      const lastRun = state.lastRuns[task.name];
      const lastRunDate = lastRun ? new Date(lastRun.startTime) : null;

      if (shouldRunNow(task.schedule, lastRunDate)) {
        await runTask(task.name);
      }
    }
  };

  // Initial check
  await checkAndRun();

  // Check every minute
  const interval = setInterval(async () => {
    if (signal?.aborted) {
      clearInterval(interval);
      return;
    }
    await checkAndRun();
  }, 60000);

  // Handle shutdown
  if (signal) {
    signal.addEventListener('abort', () => {
      clearInterval(interval);
      log.info('Maintenance daemon stopped.');
    });
  }

  // Keep process alive
  await new Promise<void>((resolve) => {
    if (signal) {
      signal.addEventListener('abort', () => resolve());
    }
  });
}
