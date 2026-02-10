/**
 * Pre-compact hook handler.
 * Called before a Claude Code session is compacted.
 * Ingests the session into the memory system.
 *
 * Features:
 * - Retry logic for transient errors
 * - Structured JSON logging
 * - Execution metrics
 * - Graceful degradation on failure
 */

import { ingestSession } from '../ingest/ingest-session.js';
import { clusterManager } from '../clusters/cluster-manager.js';
import { vectorStore } from '../storage/vector-store.js';
import {
  executeHook,
  logHook,
  isTransientError,
  type HookMetrics,
} from './hook-utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pre-compact');

/**
 * Result of pre-compact hook execution.
 */
export interface PreCompactResult {
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
 * Options for pre-compact hook.
 */
export interface PreCompactOptions {
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
async function internalHandlePreCompact(sessionPath: string): Promise<PreCompactResult> {
  const startTime = Date.now();

  // Ingest the session
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

  // Assign new chunks to existing clusters
  let clustersAssigned = 0;
  if (ingestResult.chunkCount > 0) {
    try {
      // Get the newly created chunk embeddings
      const vectors = await vectorStore.getAllVectors();
      // Filter to just the new session's chunks (rough heuristic: recent ones)
      const recentVectors = vectors.slice(-ingestResult.chunkCount);

      const assignResult = await clusterManager.assignNewChunks(recentVectors);
      clustersAssigned = assignResult.assigned;
    } catch (error) {
      // Log but don't fail - cluster assignment is secondary
      logHook({
        level: 'warn',
        hook: 'pre-compact',
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
 * Handle pre-compact hook.
 * Called by Claude Code before session compaction.
 *
 * @param sessionPath - Path to the session JSONL file
 * @param options - Hook options
 * @returns Result of the ingestion
 */
export async function handlePreCompact(
  sessionPath: string,
  options: PreCompactOptions = {}
): Promise<PreCompactResult> {
  const {
    enableRetry = true,
    maxRetries = 3,
    gracefulDegradation = true,
  } = options;

  const fallbackResult: PreCompactResult = {
    sessionId: 'unknown',
    chunkCount: 0,
    edgeCount: 0,
    clustersAssigned: 0,
    durationMs: 0,
    skipped: false,
    degraded: true,
  };

  const { result, metrics } = await executeHook(
    'pre-compact',
    () => internalHandlePreCompact(sessionPath),
    {
      retry: enableRetry
        ? {
            maxRetries,
            retryOn: isTransientError,
          }
        : undefined,
      fallback: gracefulDegradation ? fallbackResult : undefined,
    }
  );

  return {
    ...result,
    metrics,
    durationMs: metrics.durationMs ?? result.durationMs,
  };
}

/**
 * CLI entry point for pre-compact hook.
 */
export async function preCompactCli(sessionPath: string): Promise<void> {
  try {
    const result = await handlePreCompact(sessionPath);

    if (result.degraded) {
      log.error('Pre-compact hook ran in degraded mode due to errors.');
      process.exit(1);
    }

    if (result.skipped) {
      log.info(`Session ${result.sessionId} already ingested, skipped.`);
    } else {
      log.info(`Ingested session ${result.sessionId}: Chunks: ${result.chunkCount}, Edges: ${result.edgeCount}, Clusters assigned: ${result.clustersAssigned}, Duration: ${result.durationMs}ms`);
      if (result.metrics?.retryCount && result.metrics.retryCount > 0) {
        log.info(`Retries: ${result.metrics.retryCount}`);
      }
    }
  } catch (error) {
    log.error('Pre-compact hook failed:', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}
