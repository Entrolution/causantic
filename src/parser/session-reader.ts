/**
 * Reads Claude Code session JSONL files.
 * Uses readline for streaming large files (some sessions are 100MB+).
 * Filters out noise types (progress, file-history-snapshot) early.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { RawMessage, RawMessageType, SessionInfo } from './types.js';

const NOISE_TYPES: Set<RawMessageType> = new Set([
  'progress',
  'file-history-snapshot',
]);

export interface ReadOptions {
  /** Include sidechain (subagent) messages. Default: false. */
  includeSidechains?: boolean;
  /** Include progress/snapshot lines. Default: false. */
  includeNoise?: boolean;
}

/**
 * Stream conversation messages from a session JSONL file.
 * Yields only user/assistant messages from the main chain by default.
 */
export async function* readSession(
  filePath: string,
  options: ReadOptions = {},
): AsyncGenerator<RawMessage> {
  const { includeSidechains = false, includeNoise = false } = options;

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let parsed: RawMessage;
    try {
      parsed = JSON.parse(line) as RawMessage;
    } catch {
      // Skip malformed lines
      continue;
    }

    // Filter noise types
    if (!includeNoise && NOISE_TYPES.has(parsed.type)) continue;

    // Filter sidechains
    if (!includeSidechains && parsed.isSidechain) continue;

    yield parsed;
  }
}

/**
 * Collect all conversation messages from a session file into an array.
 */
export async function readSessionMessages(
  filePath: string,
  options: ReadOptions = {},
): Promise<RawMessage[]> {
  const messages: RawMessage[] = [];
  for await (const msg of readSession(filePath, options)) {
    messages.push(msg);
  }
  return messages;
}

/**
 * Extract session metadata without loading all messages into memory.
 */
export async function getSessionInfo(filePath: string): Promise<SessionInfo> {
  const fileStats = await stat(filePath);
  let sessionId = '';
  let slug = '';
  let cwd = '';
  let startTime = '';
  let endTime = '';
  let messageCount = 0;

  for await (const msg of readSession(filePath)) {
    messageCount++;
    if (!sessionId && msg.sessionId) sessionId = msg.sessionId;
    if (!slug && msg.slug) slug = msg.slug;
    if (!cwd && msg.cwd) cwd = msg.cwd;
    if (!startTime && msg.timestamp) startTime = msg.timestamp;
    if (msg.timestamp) endTime = msg.timestamp;
  }

  return {
    sessionId,
    slug,
    cwd,
    messageCount,
    startTime,
    endTime,
    filePath,
  };
}
