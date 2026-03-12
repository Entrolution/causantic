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
import { getRecentSessionStates } from '../storage/session-state-store.js';
import type { StoredSessionState } from '../storage/session-state-store.js';
import type { SessionInfo } from '../storage/chunk-store.js';
import type { StoredChunk } from '../storage/types.js';
import { approximateTokens } from '../utils/token-counter.js';

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
  /** Filter to a specific agent */
  agentFilter?: string;
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
  agentId: string | null;
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
 * Formatting overhead for reconstruction output.
 *
 * Fixed: result header (~25 tokens) + truncation notice + margin.
 * Per-chunk: separator `---` (~2 tokens) + session/agent headers amortized (~3 tokens).
 */
const RECONSTRUCT_FIXED_OVERHEAD = 50;
const RECONSTRUCT_PER_CHUNK_OVERHEAD = 5;

/**
 * Apply token budget to a list of chunks, reserving space for formatting overhead.
 * Returns the subset that fits within the budget.
 */
export function applyTokenBudget(
  chunks: StoredChunk[],
  maxTokens: number,
  keepNewest: boolean,
): { kept: StoredChunk[]; truncated: boolean } {
  const effectiveBudget = Math.max(0, maxTokens - RECONSTRUCT_FIXED_OVERHEAD);

  let totalCost = 0;
  for (const c of chunks) {
    totalCost += c.approxTokens + RECONSTRUCT_PER_CHUNK_OVERHEAD;
  }

  if (totalCost <= effectiveBudget) {
    return { kept: chunks, truncated: false };
  }

  // Walk from the preferred end and collect until budget exhausted
  const ordered = keepNewest ? [...chunks].reverse() : [...chunks];
  const kept: StoredChunk[] = [];
  let budget = effectiveBudget;

  for (const chunk of ordered) {
    const chunkCost = chunk.approxTokens + RECONSTRUCT_PER_CHUNK_OVERHEAD;
    if (chunkCost > budget) break;
    kept.push(chunk);
    budget -= chunkCost;
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

  // Detect if any session has multiple agents
  const hasAgents = result.chunks.some((c) => c.agentId && c.agentId !== 'ui');

  const lines: string[] = [];
  let currentSessionId = '';
  let currentAgentId: string | null | undefined = undefined;

  // Group chunks by session and add headers
  for (const chunk of result.chunks) {
    if (chunk.sessionId !== currentSessionId) {
      currentSessionId = chunk.sessionId;
      currentAgentId = undefined; // Reset agent tracking on session change
      const session = result.sessions.find((s) => s.sessionId === currentSessionId);
      if (session) {
        const startStr = formatDate(session.firstChunkTime);
        const endStr = formatDate(session.lastChunkTime);
        lines.push(`=== Session ${session.sessionId.slice(0, 8)} (${startStr} – ${endStr}) ===`);
      }
    }

    // Show agent boundaries when session has agents
    if (hasAgents && chunk.agentId !== currentAgentId) {
      currentAgentId = chunk.agentId;
      if (currentAgentId && currentAgentId !== 'ui') {
        lines.push(`--- Agent: ${currentAgentId} ---`);
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
    agentId: c.agentId,
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
    const rawChunks = getChunksBefore(req.project, before, limit, req.agentFilter);

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
    window.sessionId
      ? { sessionId: window.sessionId, agentId: req.agentFilter }
      : req.agentFilter
        ? { agentId: req.agentFilter }
        : undefined,
  );

  const { kept, truncated } = applyTokenBudget(rawChunks, maxTokens, keepNewest);

  return buildResult(kept, truncated, window.to, window.from);
}

/**
 * Request for a session briefing.
 */
export interface BriefingRequest {
  /** Project slug (required). */
  project: string;
  /** Optional repo map text to include. */
  repoMapText?: string;
  /** Maximum sessions to include. Default: 3. */
  maxSessions?: number;
  /** Token budget. Defaults to mcpMaxResponseTokens. */
  maxTokens?: number;
}

/**
 * Result of a session briefing.
 */
export interface BriefingResult {
  /** Formatted briefing text. */
  text: string;
  /** Approximate token count. */
  tokenCount: number;
  /** Number of session states included. */
  sessionCount: number;
  /** Whether repo map was included. */
  hasRepoMap: boolean;
}

/**
 * Format a single session state for display in a briefing.
 */
function formatSessionStateForBriefing(state: StoredSessionState): string {
  const lines: string[] = [];

  const endDate = new Date(state.endedAt);
  const dateStr = endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) + ', ' + endDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  lines.push(`### Session ${state.sessionId.slice(0, 8)} (${dateStr})`);

  // Summary if available
  if (state.summary) {
    lines.push(state.summary);
  }

  // Files touched (show top 10)
  if (state.filesTouched.length > 0) {
    lines.push('');
    const displayFiles = state.filesTouched.slice(0, 10);
    lines.push(`**Files touched** (${state.filesTouched.length}):`);
    for (const f of displayFiles) {
      lines.push(`- ${f}`);
    }
    if (state.filesTouched.length > 10) {
      lines.push(`- ...and ${state.filesTouched.length - 10} more`);
    }
  }

  // Outcomes
  if (state.outcomes.length > 0) {
    lines.push('');
    lines.push(`**Outcomes:** ${state.outcomes.join(', ')}`);
  }

  // Errors (show top 3)
  if (state.errors.length > 0) {
    lines.push('');
    lines.push(`**Errors** (${state.errors.length}):`);
    for (const err of state.errors.slice(0, 3)) {
      lines.push(`- \`${err.tool}\`: ${err.message}`);
      if (err.resolution) {
        lines.push(`  Resolution: ${err.resolution}`);
      }
    }
    if (state.errors.length > 3) {
      lines.push(`- ...and ${state.errors.length - 3} more`);
    }
  }

  // Tasks
  if (state.tasks.length > 0) {
    lines.push('');
    lines.push('**Tasks:**');
    for (const task of state.tasks) {
      const statusIcon = task.status === 'completed' ? '[x]' : '[ ]';
      lines.push(`- ${statusIcon} ${task.description} (${task.status})`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a structured session briefing for resuming work.
 *
 * Combines:
 * - Recent session states (files touched, errors, outcomes, tasks)
 * - Optional repo map text
 *
 * Designed for use at session start via the reconstruct tool's briefing mode.
 */
export function buildBriefing(req: BriefingRequest): BriefingResult {
  const config = getConfig();
  const maxTokens = req.maxTokens ?? config.mcpMaxResponseTokens;
  const maxSessions = req.maxSessions ?? 3;

  const sections: string[] = [];
  let hasRepoMap = false;

  // 1. Repo map section (if provided)
  if (req.repoMapText && req.repoMapText.length > 0) {
    const repoMapTokens = approximateTokens(req.repoMapText);
    const repoMapBudget = Math.floor(maxTokens * 0.4);
    sections.push('## Project Structure\n');
    // Truncate repo map if it exceeds budget
    if (repoMapTokens > repoMapBudget) {
      const charBudget = Math.floor(repoMapBudget * 3.5);
      sections.push(req.repoMapText.slice(0, charBudget) + '\n...(truncated)');
    } else {
      sections.push(req.repoMapText);
    }
    hasRepoMap = true;
  }

  // 2. Recent session states
  let sessionStates: StoredSessionState[] = [];
  try {
    sessionStates = getRecentSessionStates(req.project, maxSessions);
  } catch {
    // Table may not exist yet
  }

  if (sessionStates.length > 0) {
    sections.push('\n## Recent Sessions\n');
    // Show in chronological order (store returns DESC)
    const chronological = [...sessionStates].reverse();
    for (const state of chronological) {
      sections.push(formatSessionStateForBriefing(state));
    }
  }

  // Build final text
  let text: string;
  if (sections.length === 0) {
    text = `No session history or project structure available for "${req.project}".`;
  } else {
    const header = `# Session Briefing: ${req.project}\n\n`;
    text = header + sections.join('\n');
  }

  const tokenCount = approximateTokens(text);

  return {
    text,
    tokenCount,
    sessionCount: sessionStates.length,
    hasRepoMap,
  };
}
