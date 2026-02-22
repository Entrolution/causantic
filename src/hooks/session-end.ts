/**
 * Session-end hook handler.
 * Called when a Claude Code session ends (clear, logout, exit).
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
  return ingestionHookCli('session-end', () => handleSessionEnd(sessionPath), 1);
}
