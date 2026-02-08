/**
 * Reads Claude Code session JSONL files.
 * Uses readline for streaming large files (some sessions are 100MB+).
 * Filters out noise types (progress, file-history-snapshot) early.
 */

import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
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

/**
 * Information about a discovered sub-agent.
 */
export interface SubAgentInfo {
  /** Unique identifier for this sub-agent */
  agentId: string;
  /** Path to the sub-agent's JSONL file */
  filePath: string;
}

/**
 * Discover sub-agent JSONL files associated with a session.
 * Sub-agent files are stored in a 'subagents' directory next to the main session file,
 * with naming pattern: agent-<agentId>.jsonl or <agentId>.jsonl
 *
 * @param sessionPath - Path to the main session JSONL file
 * @returns Array of discovered sub-agents
 */
export async function discoverSubAgents(sessionPath: string): Promise<SubAgentInfo[]> {
  const sessionDir = dirname(sessionPath);

  // Extract session ID from filename (e.g., "abc123.jsonl" -> "abc123")
  const sessionFileName = sessionPath.split('/').pop() ?? '';
  const sessionId = sessionFileName.replace('.jsonl', '');

  // Subagents are in a sibling directory named after the session ID
  // Structure: <project>/<session-id>.jsonl and <project>/<session-id>/subagents/
  const subagentsDir = join(sessionDir, sessionId, 'subagents');

  if (!existsSync(subagentsDir)) {
    return [];
  }

  const subAgents: SubAgentInfo[] = [];

  try {
    const files = readdirSync(subagentsDir);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      // Extract agent ID from filename
      // Patterns: agent-<agentId>.jsonl or <agentId>.jsonl
      let agentId: string;
      if (file.startsWith('agent-')) {
        agentId = file.slice(6, -6); // Remove 'agent-' prefix and '.jsonl' suffix
      } else {
        agentId = file.slice(0, -6); // Remove '.jsonl' suffix
      }

      subAgents.push({
        agentId,
        filePath: join(subagentsDir, file),
      });
    }
  } catch (error) {
    // Directory exists but can't be read - log and continue
    console.warn(`Warning: Could not read subagents directory: ${subagentsDir}`);
  }

  return subAgents;
}

/**
 * Check if a session has any sub-agents.
 *
 * @param sessionPath - Path to the main session JSONL file
 * @returns true if sub-agents exist
 */
export async function hasSubAgents(sessionPath: string): Promise<boolean> {
  const subAgents = await discoverSubAgents(sessionPath);
  return subAgents.length > 0;
}
