/**
 * Pre-compact hook handler.
 * Called before a Claude Code session is compacted.
 * Ingests the session into the memory system.
 *
 * Delegates to shared handleIngestionHook() for retry, metrics, and fallback.
 */

import {
  handleIngestionHook,
  type IngestionHookResult,
  type IngestionHookOptions,
} from './hook-utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pre-compact');

/** Result of pre-compact hook execution (alias for shared type). */
export type PreCompactResult = IngestionHookResult;

/** Options for pre-compact hook (alias for shared type). */
export type PreCompactOptions = IngestionHookOptions;

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
  options: PreCompactOptions = {},
): Promise<PreCompactResult> {
  return handleIngestionHook('pre-compact', sessionPath, options);
}

/**
 * CLI entry point for pre-compact hook.
 */
export async function preCompactCli(sessionPath: string): Promise<void> {
  try {
    const result = await handlePreCompact(sessionPath);

    if (result.degraded) {
      log.warn('Pre-compact hook ran in degraded mode due to errors.');
      process.exit(0);
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
    log.error('Pre-compact hook failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
