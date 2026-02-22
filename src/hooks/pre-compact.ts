/**
 * Pre-compact hook handler.
 * Called before a Claude Code session is compacted.
 * Ingests the session into the memory system.
 *
 * Delegates to shared handleIngestionHook() for retry, metrics, and fallback.
 */

import {
  handleIngestionHook,
  ingestionHookCli,
  type IngestionHookResult,
  type IngestionHookOptions,
} from './hook-utils.js';

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
  return ingestionHookCli('pre-compact', () => handlePreCompact(sessionPath), 0);
}
