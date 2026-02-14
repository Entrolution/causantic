/**
 * Session-end hook handler.
 * Called when a Claude Code session ends (clear, logout, exit).
 * Ingests the session into the memory system.
 *
 * Features:
 * - Retry logic for transient errors
 * - Structured JSON logging
 * - Execution metrics
 * - Graceful degradation on failure
 */

import {
  executeHook,
  isTransientError,
  ingestCurrentSession,
  type HookMetrics,
} from './hook-utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-end');

/**
 * Result of session-end hook execution.
 */
export interface SessionEndResult {
  /** Session ID that was ingested */
  sessionId: string;
  /** Number of chunks created */
  chunkCount: number;
  /** Number of edges created */
  edgeCount: number;
  /** Number of clusters the new chunks were assigned to */
  clustersAssigned: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Whether ingestion was skipped (already existed) */
  skipped: boolean;
  /** Hook execution metrics */
  metrics?: HookMetrics;
  /** Whether this is a fallback result due to error */
  degraded?: boolean;
}

/**
 * Options for session-end hook.
 */
export interface SessionEndOptions {
  /** Enable retry on transient errors. Default: true */
  enableRetry?: boolean;
  /** Maximum retries. Default: 3 */
  maxRetries?: number;
  /** Return fallback on total failure. Default: true */
  gracefulDegradation?: boolean;
}

/**
 * Internal handler without retry logic.
 */
async function internalHandleSessionEnd(sessionPath: string): Promise<SessionEndResult> {
  return ingestCurrentSession('session-end', sessionPath);
}

/**
 * Handle session-end hook.
 * Called by Claude Code when a session ends (clear, logout, exit).
 *
 * @param sessionPath - Path to the session JSONL file
 * @param options - Hook options
 * @returns Result of the ingestion
 */
export async function handleSessionEnd(
  sessionPath: string,
  options: SessionEndOptions = {},
): Promise<SessionEndResult> {
  const { enableRetry = true, maxRetries = 3, gracefulDegradation = true } = options;

  const fallbackResult: SessionEndResult = {
    sessionId: 'unknown',
    chunkCount: 0,
    edgeCount: 0,
    clustersAssigned: 0,
    durationMs: 0,
    skipped: false,
    degraded: true,
  };

  const { result, metrics } = await executeHook(
    'session-end',
    () => internalHandleSessionEnd(sessionPath),
    {
      retry: enableRetry
        ? {
            maxRetries,
            retryOn: isTransientError,
          }
        : undefined,
      fallback: gracefulDegradation ? fallbackResult : undefined,
    },
  );

  return {
    ...result,
    metrics,
    durationMs: metrics.durationMs ?? result.durationMs,
  };
}

/**
 * CLI entry point for session-end hook.
 */
export async function sessionEndCli(sessionPath: string): Promise<void> {
  try {
    const result = await handleSessionEnd(sessionPath);

    if (result.degraded) {
      log.error('Session-end hook ran in degraded mode due to errors.');
      process.exit(1);
    }

    if (result.skipped) {
      log.info(`Session ${result.sessionId} already ingested, skipped.`);
    } else {
      log.info(
        `Ingested session ${result.sessionId}: Chunks: ${result.chunkCount}, Edges: ${result.edgeCount}, Clusters assigned: ${result.clustersAssigned}, Duration: ${result.durationMs}ms`,
      );
      if (result.metrics?.retryCount && result.metrics.retryCount > 0) {
        log.info(`Retries: ${result.metrics.retryCount}`);
      }
    }
  } catch (error) {
    log.error('Session-end hook failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
