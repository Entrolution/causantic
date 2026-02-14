/**
 * Hook utilities for error recovery, logging, and metrics.
 *
 * Provides:
 * - Structured JSON logging
 * - Retry logic with exponential backoff
 * - Hook execution metrics
 * - Graceful degradation on failure
 */

/** Log entry structure */
export interface HookLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  hook: string;
  event: string;
  durationMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/** Hook execution metrics */
export interface HookMetrics {
  hookName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success?: boolean;
  retryCount: number;
  error?: string;
}

/** Retry options */
export interface RetryOptions {
  /** Maximum number of retries. Default: 3 */
  maxRetries?: number;
  /** Initial delay in ms. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum delay in ms. Default: 10000 */
  maxDelayMs?: number;
  /** Backoff multiplier. Default: 2 */
  backoffFactor?: number;
  /** Errors to retry on. Default: all errors */
  retryOn?: (error: Error) => boolean;
}

/** Hook configuration */
export interface HookConfig {
  /** Enable structured JSON logging. Default: env CAUSANTIC_HOOK_LOGGING === 'true' */
  enableLogging?: boolean;
  /** Log level: 'debug' | 'info' | 'warn' | 'error'. Default: 'info' */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// Global configuration
let hookConfig: HookConfig = {
  enableLogging: process.env.CAUSANTIC_HOOK_LOGGING === 'true',
  logLevel: (process.env.CAUSANTIC_HOOK_LOG_LEVEL as HookConfig['logLevel']) ?? 'info',
};

/**
 * Configure hook utilities.
 */
export function configureHooks(config: Partial<HookConfig>): void {
  hookConfig = { ...hookConfig, ...config };
}

/**
 * Log a structured message.
 */
export function logHook(entry: Omit<HookLogEntry, 'timestamp'>): void {
  if (!hookConfig.enableLogging) return;

  const levels = ['debug', 'info', 'warn', 'error'];
  const configLevel = levels.indexOf(hookConfig.logLevel ?? 'info');
  const entryLevel = levels.indexOf(entry.level);

  if (entryLevel < configLevel) return;

  const logEntry: HookLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Write to stderr to avoid interfering with hook output
  process.stderr.write(JSON.stringify(logEntry) + '\n');
}

/**
 * Calculate exponential backoff delay.
 */
function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
): number {
  const delay = initialDelayMs * Math.pow(backoffFactor, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic.
 */
export async function withRetry<T>(
  hookName: string,
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    retryOn = () => true,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateBackoff(attempt - 1, initialDelayMs, maxDelayMs, backoffFactor);

        logHook({
          level: 'info',
          hook: hookName,
          event: 'retry_attempt',
          details: { attempt, delay, maxRetries },
        });

        await sleep(delay);
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logHook({
        level: attempt === maxRetries ? 'error' : 'warn',
        hook: hookName,
        event: attempt === maxRetries ? 'retry_exhausted' : 'retry_error',
        error: lastError.message,
        details: { attempt, maxRetries },
      });

      // Check if we should retry this error
      if (!retryOn(lastError)) {
        throw lastError;
      }
    }
  }

  throw lastError;
}

/**
 * Create a metrics tracker for a hook execution.
 */
export function createMetrics(hookName: string): HookMetrics {
  return {
    hookName,
    startTime: Date.now(),
    retryCount: 0,
  };
}

/**
 * Complete metrics tracking.
 */
export function completeMetrics(
  metrics: HookMetrics,
  success: boolean,
  error?: Error,
): HookMetrics {
  metrics.endTime = Date.now();
  metrics.durationMs = metrics.endTime - metrics.startTime;
  metrics.success = success;
  if (error) {
    metrics.error = error.message;
  }
  return metrics;
}

/**
 * Wrap a hook function with logging, metrics, error handling, and status recording.
 */
export async function executeHook<T>(
  hookName: string,
  fn: () => Promise<T>,
  options: {
    retry?: RetryOptions;
    fallback?: T;
    /** Project name for status tracking. */
    project?: string;
  } = {},
): Promise<{ result: T; metrics: HookMetrics }> {
  // Late import to keep hook-status optional; uses static import path
  // but deferred so the module only loads when executeHook is called.
  let recordStatus: typeof import('./hook-status.js').recordHookStatus = () => {};
  try {
    const mod = await import('./hook-status.js');
    recordStatus = mod.recordHookStatus;
  } catch {
    // hook-status unavailable — continue without recording
  }

  const metrics = createMetrics(hookName);

  logHook({
    level: 'info',
    hook: hookName,
    event: 'hook_started',
  });

  try {
    let result: T;

    if (options.retry) {
      result = await withRetry(hookName, fn, options.retry);
    } else {
      result = await fn();
    }

    completeMetrics(metrics, true);

    logHook({
      level: 'info',
      hook: hookName,
      event: 'hook_completed',
      durationMs: metrics.durationMs,
    });

    recordStatus(hookName, {
      lastRun: new Date().toISOString(),
      success: true,
      durationMs: metrics.durationMs ?? 0,
      project: options.project ?? null,
      error: null,
    });

    return { result, metrics };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    completeMetrics(metrics, false, err);

    logHook({
      level: 'error',
      hook: hookName,
      event: 'hook_failed',
      durationMs: metrics.durationMs,
      error: err.message,
    });

    recordStatus(hookName, {
      lastRun: new Date().toISOString(),
      success: false,
      durationMs: metrics.durationMs ?? 0,
      project: options.project ?? null,
      error: err.message,
    });

    // Use fallback if provided (graceful degradation)
    if (options.fallback !== undefined) {
      logHook({
        level: 'warn',
        hook: hookName,
        event: 'using_fallback',
      });
      return { result: options.fallback, metrics };
    }

    throw error;
  }
}

/** Result of a session ingestion via hook. */
export interface IngestionResult {
  sessionId: string;
  chunkCount: number;
  edgeCount: number;
  clustersAssigned: number;
  durationMs: number;
  skipped: boolean;
}

/**
 * Shared ingestion logic used by both PreCompact and SessionEnd hooks.
 *
 * Ingests the session, then assigns new chunks to existing clusters.
 * Cluster assignment failures are logged but non-fatal.
 */
export async function ingestCurrentSession(
  hookName: string,
  sessionPath: string,
): Promise<IngestionResult> {
  const { ingestSession } = await import('../ingest/ingest-session.js');
  const { clusterManager } = await import('../clusters/cluster-manager.js');
  const { vectorStore } = await import('../storage/vector-store.js');

  const startTime = Date.now();

  const ingestResult = await ingestSession(sessionPath, {
    skipIfExists: true,
    linkCrossSessions: true,
  });

  if (ingestResult.skipped) {
    return {
      sessionId: ingestResult.sessionId,
      chunkCount: 0,
      edgeCount: 0,
      clustersAssigned: 0,
      durationMs: Date.now() - startTime,
      skipped: true,
    };
  }

  let clustersAssigned = 0;
  if (ingestResult.chunkCount > 0) {
    try {
      const vectors = await vectorStore.getAllVectors();
      const recentVectors = vectors.slice(-ingestResult.chunkCount);
      const assignResult = await clusterManager.assignNewChunks(recentVectors);
      clustersAssigned = assignResult.assigned;
    } catch (error) {
      logHook({
        level: 'warn',
        hook: hookName,
        event: 'cluster_assignment_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    sessionId: ingestResult.sessionId,
    chunkCount: ingestResult.chunkCount,
    edgeCount: ingestResult.edgeCount,
    clustersAssigned,
    durationMs: Date.now() - startTime,
    skipped: false,
  };
}

/**
 * Check if an error is transient (worth retrying).
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network/connectivity errors
  if (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network')
  ) {
    return true;
  }

  // Database busy/locked errors
  if (
    message.includes('database is locked') ||
    message.includes('busy') ||
    message.includes('sqlite_busy')
  ) {
    return true;
  }

  // Rate limiting
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  return false;
}
