/**
 * Reads Claude Code session JSONL files.
 * Uses readline for streaming large files (some sessions are 100MB+).
 * Filters out noise types (progress, file-history-snapshot) early.
 */

import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';
import type { RawMessage, RawMessageType, SessionInfo } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-reader');

const NOISE_TYPES: Set<RawMessageType> = new Set(['progress', 'file-history-snapshot']);

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
 * Stream session messages as an async generator.
 * Alias for readSession that's explicit about streaming behavior.
 * Use this for memory-efficient processing of large session files.
 */
export async function* streamSessionMessages(
  filePath: string,
  options: ReadOptions = {},
): AsyncGenerator<RawMessage> {
  yield* readSession(filePath, options);
}

/**
 * Extract session metadata without loading all messages into memory.
 */
export async function getSessionInfo(filePath: string): Promise<SessionInfo> {
  await stat(filePath);
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
  /** Whether this file is a dead end (no assistant content, very few lines) */
  isDeadEnd: boolean;
  /** Number of non-empty lines in the file */
  lineCount: number;
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

      const filePath = join(subagentsDir, file);
      const { isDeadEnd, lineCount } = classifySubAgentFile(filePath);

      subAgents.push({
        agentId,
        filePath,
        isDeadEnd,
        lineCount,
      });
    }
  } catch {
    // Directory exists but can't be read - log and continue
    log.warn(`Could not read subagents directory: ${subagentsDir}`);
  }

  return subAgents;
}

/**
 * Classify a sub-agent file as active or dead-end.
 *
 * Dead-end detection uses two signals:
 * 1. No assistant messages in the first ~10 lines (primary)
 * 2. File has ≤2 non-empty lines (secondary)
 *
 * A file must fail BOTH checks (no assistant content AND ≤2 lines) to be dead-end.
 */
function classifySubAgentFile(filePath: string): { isDeadEnd: boolean; lineCount: number } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    const nonEmptyLines = allLines.filter((l) => l.trim().length > 0);
    const lineCount = nonEmptyLines.length;

    // Check first ~10 lines for assistant messages
    let hasAssistant = false;
    const linesToCheck = Math.min(nonEmptyLines.length, 10);
    for (let i = 0; i < linesToCheck; i++) {
      try {
        const parsed = JSON.parse(nonEmptyLines[i]);
        if (parsed.message?.role === 'assistant') {
          hasAssistant = true;
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Dead end only if BOTH: no assistant content AND ≤2 lines
    const isDeadEnd = !hasAssistant && lineCount <= 2;

    return { isDeadEnd, lineCount };
  } catch {
    // If we can't read the file, treat as dead end
    return { isDeadEnd: true, lineCount: 0 };
  }
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

/**
 * Derive a human-readable project slug from session info.
 *
 * Fallback chain:
 * 1. basename(info.cwd) — most reliable (e.g., "apolitical-assistant")
 * 2. info.slug — forward-compatibility if Claude Code starts populating it
 * 3. '' — final fallback
 *
 * Note: directory name decoding (`-Users-gvn-Dev-Foo` → `/Users/gvn/Dev/Foo`)
 * is NOT used because hyphens in project names make it ambiguous.
 * `cwd` from JSONL is the source of truth.
 *
 * @param info - Session metadata
 * @param knownSlugs - Optional map of slug → cwd for collision detection.
 *   If two projects share the same basename (e.g., ~/Work/api and ~/Personal/api),
 *   the last two path components are used instead: "Work/api" vs "Personal/api".
 */
export function deriveProjectSlug(info: SessionInfo, knownSlugs?: Map<string, string>): string {
  if (info.cwd) {
    let slug = basename(info.cwd);

    // Check for collision: same basename but different cwd
    if (knownSlugs) {
      const existingCwd = knownSlugs.get(slug);
      if (existingCwd && existingCwd !== info.cwd) {
        // Disambiguate using last two path components
        slug = twoComponentSlug(info.cwd);
      }
    }

    return slug;
  }

  if (info.slug) {
    return info.slug;
  }

  return '';
}

/**
 * Build a slug from the last two path components.
 * e.g., "/Users/gvn/Work/api" → "Work/api"
 */
function twoComponentSlug(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }
  return parts[parts.length - 1] ?? '';
}
