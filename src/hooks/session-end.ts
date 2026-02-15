/**
 * Session-end hook handler.
 * Called when a Claude Code session ends (clear, logout, exit).
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

const log = createLogger('session-end');

/** Result of session-end hook execution (alias for shared type). */
export type SessionEndResult = IngestionHookResult;

/** Options for session-end hook (alias for shared type). */
export type SessionEndOptions = IngestionHookOptions;

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
  return handleIngestionHook('session-end', sessionPath, options);
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
