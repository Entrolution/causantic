/**
 * Session context reconstruction.
 *
 * Pure chronological SQLite queries — bypasses the vector/keyword/RRF pipeline.
 * Rebuilds session context by time range with token budgeting.
 */

import { getConfig } from '../config/memory-config.js';
import {
  getChunksByTimeRange,
  getChunksBefore,
  getPreviousSession,
  ESTIMATED_AVG_TOKENS_PER_CHUNK,
} from '../storage/chunk-store.js';
import type { SessionInfo } from '../storage/chunk-store.js';
import type { StoredChunk } from '../storage/types.js';

/**
 * Request to reconstruct session context.
 */
export interface ReconstructRequest {
  /** Project slug (required) */
  project: string;
  /** Specific session ID */
  sessionId?: string;
  /** Start of time window (ISO 8601) */
  from?: string;
  /** End of time window (ISO 8601) */
  to?: string;
  /** Look back N days from now */
  daysBack?: number;
  /** Get the session before the current one */
  previousSession?: boolean;
  /** Current session ID (required when previousSession is true) */
  currentSessionId?: string;
  /** Token budget (defaults to mcpMaxResponseTokens) */
  maxTokens?: number;
  /** When truncating, keep newest chunks (default: true) */
  keepNewest?: boolean;
}

/**
 * A chunk in the reconstruction result.
 */
export interface ReconstructChunk {
  id: string;
  sessionId: string;
  content: string;
  startTime: string;
  approxTokens: number;
}

/**
 * Result of session reconstruction.
 */
export interface ReconstructResult {
  chunks: ReconstructChunk[];
  sessions: SessionInfo[];
  totalTokens: number;
  truncated: boolean;
  timeRange: { from: string; to: string };
}

/**
 * Resolve the time window from a ReconstructRequest into concrete from/to ISO dates.
 */
export function resolveTimeWindow(req: ReconstructRequest): {
  from: string;
  to: string;
  sessionId?: string;
} {
  if (req.previousSession) {
    if (!req.currentSessionId) {
      throw new Error('currentSessionId is required when previousSession is true');
    }
    const prev = getPreviousSession(req.project, req.currentSessionId);
    if (!prev) {
      return { from: '', to: '', sessionId: undefined };
    }
    return {
      from: prev.firstChunkTime,
      to: new Date(new Date(prev.lastChunkTime).getTime() + 1).toISOString(),
      sessionId: prev.sessionId,
    };
  }

  if (req.sessionId) {
    // For a specific session, use a wide time window and filter by sessionId
    return { from: '1970-01-01T00:00:00Z', to: '9999-12-31T23:59:59Z', sessionId: req.sessionId };
  }

  if (req.daysBack !== null && req.daysBack !== undefined) {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - req.daysBack * 24 * 60 * 60 * 1000).toISOString();
    return { from, to };
  }

  if (req.from || req.to) {
    return {
      from: req.from ?? '1970-01-01T00:00:00Z',
      to: req.to ?? '9999-12-31T23:59:59Z',
    };
  }

  throw new Error('Must specify one of: sessionId, from/to, daysBack, or previousSession');
}

/**
 * Apply token budget to a list of chunks.
 * Returns the subset that fits within the budget.
 */
export function applyTokenBudget(
  chunks: StoredChunk[],
  maxTokens: number,
  keepNewest: boolean,
): { kept: StoredChunk[]; truncated: boolean } {
  let totalTokens = 0;
  for (const c of chunks) {
    totalTokens += c.approxTokens;
  }

  if (totalTokens <= maxTokens) {
    return { kept: chunks, truncated: false };
  }

  // Walk from the preferred end and collect until budget exhausted
  const ordered = keepNewest ? [...chunks].reverse() : [...chunks];
  const kept: StoredChunk[] = [];
  let budget = maxTokens;

  for (const chunk of ordered) {
    if (chunk.approxTokens > budget) break;
    kept.push(chunk);
    budget -= chunk.approxTokens;
  }

  // Restore chronological order
  if (keepNewest) {
    kept.reverse();
  }

  return { kept, truncated: true };
}

/**
 * Format a date for display in session headers.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }) +
    ', ' +
    d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  );
}

/**
 * Format reconstruction result as text with session boundary markers.
 */
export function formatReconstruction(result: ReconstructResult): string {
  if (result.chunks.length === 0) {
    return 'No session data found for the specified time range.';
  }

  const lines: string[] = [];
  let currentSessionId = '';

  // Group chunks by session and add headers
  for (const chunk of result.chunks) {
    if (chunk.sessionId !== currentSessionId) {
      currentSessionId = chunk.sessionId;
      const session = result.sessions.find((s) => s.sessionId === currentSessionId);
      if (session) {
        const startStr = formatDate(session.firstChunkTime);
        const endStr = formatDate(session.lastChunkTime);
        lines.push(`=== Session ${session.sessionId.slice(0, 8)} (${startStr} – ${endStr}) ===`);
      }
    }
    lines.push(chunk.content);
    lines.push('---');
  }

  // Remove trailing separator
  if (lines[lines.length - 1] === '---') {
    lines.pop();
  }

  let header = `Reconstructed ${result.chunks.length} chunks from ${result.sessions.length} session(s) (${result.totalTokens} tokens)`;
  if (result.truncated) {
    header += ' [truncated to fit token budget]';
  }
  header += '\n\n';

  return header + lines.join('\n');
}

/**
 * Build a ReconstructResult from a set of kept chunks.
 */
function buildResult(
  kept: StoredChunk[],
  truncated: boolean,
  to: string,
  from?: string,
): ReconstructResult {
  const sessionMap = new Map<string, { chunks: StoredChunk[] }>();
  for (const chunk of kept) {
    const entry = sessionMap.get(chunk.sessionId) ?? { chunks: [] };
    entry.chunks.push(chunk);
    sessionMap.set(chunk.sessionId, entry);
  }

  const sessions: SessionInfo[] = [];
  for (const [sessionId, { chunks }] of sessionMap) {
    sessions.push({
      sessionId,
      firstChunkTime: chunks[0].startTime,
      lastChunkTime: chunks[chunks.length - 1].endTime,
      chunkCount: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.approxTokens, 0),
    });
  }

  const resultChunks: ReconstructChunk[] = kept.map((c) => ({
    id: c.id,
    sessionId: c.sessionId,
    content: c.content,
    startTime: c.startTime,
    approxTokens: c.approxTokens,
  }));

  const totalTokens = kept.reduce((sum, c) => sum + c.approxTokens, 0);
  const effectiveFrom = from ?? (kept.length > 0 ? kept[0].startTime : '');

  return {
    chunks: resultChunks,
    sessions,
    totalTokens,
    truncated,
    timeRange: { from: effectiveFrom, to },
  };
}

/**
 * Reconstruct session context for a project.
 */
export function reconstructSession(req: ReconstructRequest): ReconstructResult {
  const config = getConfig();
  const maxTokens = req.maxTokens ?? config.mcpMaxResponseTokens;
  const keepNewest = req.keepNewest ?? true;

  // Timeline mode: no explicit time window specified — walk backwards from anchor
  const isTimeline =
    !req.sessionId &&
    (req.daysBack === undefined || req.daysBack === null) &&
    !req.previousSession &&
    !req.from;

  if (isTimeline) {
    const before = req.to ?? new Date().toISOString();
    const limit = Math.ceil(maxTokens / ESTIMATED_AVG_TOKENS_PER_CHUNK);
    const rawChunks = getChunksBefore(req.project, before, limit);

    const { kept, truncated } = applyTokenBudget(rawChunks, maxTokens, keepNewest);

    return buildResult(kept, truncated, before);
  }

  const window = resolveTimeWindow(req);

  // Handle case where no previous session was found
  if (!window.from && !window.to) {
    return {
      chunks: [],
      sessions: [],
      totalTokens: 0,
      truncated: false,
      timeRange: { from: '', to: '' },
    };
  }

  const rawChunks = getChunksByTimeRange(
    req.project,
    window.from,
    window.to,
    window.sessionId ? { sessionId: window.sessionId } : undefined,
  );

  const { kept, truncated } = applyTokenBudget(rawChunks, maxTokens, keepNewest);

  return buildResult(kept, truncated, window.to, window.from);
}
