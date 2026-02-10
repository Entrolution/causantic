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
  backoffFactor: number
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
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    retryOn = () => true,
  } = options;

  let lastError: Error | null = null;
  let retryCount = 0;

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
        retryCount++;
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
  error?: Error
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
 * Wrap a hook function with logging, metrics, and error handling.
 */
export async function executeHook<T>(
  hookName: string,
  fn: () => Promise<T>,
  options: {
    retry?: RetryOptions;
    fallback?: T;
  } = {}
): Promise<{ result: T; metrics: HookMetrics }> {
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
