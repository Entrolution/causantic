/**
 * Cross-session edge detection and creation.
 * Detects continued sessions and creates a single edge across session boundaries.
 */

import { getChunksBySession, getSessionIds, getPreviousSession } from '../storage/chunk-store.js';
import { createCrossSessionEdges } from './edge-creator.js';

/**
 * Boilerplate text indicating a continued session.
 */
const CONTINUATION_PATTERNS = [
  /^This session is being continued from a previous conversation/,
  /^Continuing from previous session/,
  /^This is a continuation of/,
  /^Resumed session/,
];

/**
 * Result of cross-session linking for a single session.
 */
export interface CrossSessionLinkResult {
  /** Session ID that was linked */
  sessionId: string;
  /** Previous session ID that was linked to */
  previousSessionId: string | null;
  /** Number of edges created */
  edgeCount: number;
  /** Whether continuation was detected */
  isContinuation: boolean;
}

/**
 * Strip leading role tags (e.g. "[User]\n", "[Assistant]\n") from chunk content.
 * Chunks are rendered with role prefixes by the chunker, but continuation
 * patterns expect raw text.
 */
function stripRolePrefix(content: string): string {
  return content.replace(/^\[(?:User|Assistant|Thinking)\]\n/, '');
}

/**
 * Check if a session is a continuation of a previous session.
 */
export function isContinuedSession(firstChunkContent: string): boolean {
  const text = stripRolePrefix(firstChunkContent);
  return CONTINUATION_PATTERNS.some((p) => p.test(text));
}

/**
 * Link a session to its previous session if it's a continuation.
 * Creates a single edge: last chunk of previous session → first chunk of new session.
 *
 * @param sessionId - Session ID to check
 * @param sessionSlug - Session slug (project identifier)
 * @returns Link result
 */
export async function linkCrossSession(
  sessionId: string,
  sessionSlug: string,
): Promise<CrossSessionLinkResult> {
  const chunks = getChunksBySession(sessionId);

  if (chunks.length === 0) {
    return {
      sessionId,
      previousSessionId: null,
      edgeCount: 0,
      isContinuation: false,
    };
  }

  const firstChunk = chunks[0];

  // Check if this is a continued session
  if (!isContinuedSession(firstChunk.content)) {
    return {
      sessionId,
      previousSessionId: null,
      edgeCount: 0,
      isContinuation: false,
    };
  }

  // Find previous session for this project (uses composite index)
  const prevSessionInfo = getPreviousSession(sessionSlug, sessionId);

  if (!prevSessionInfo) {
    return {
      sessionId,
      previousSessionId: null,
      edgeCount: 0,
      isContinuation: true, // Continuation detected but no previous session found
    };
  }

  // Get chunks from previous session
  const prevChunks = getChunksBySession(prevSessionInfo.sessionId);

  if (prevChunks.length === 0) {
    return {
      sessionId,
      previousSessionId: prevSessionInfo.sessionId,
      edgeCount: 0,
      isContinuation: true,
    };
  }

  // Single edge: last chunk of previous session → first chunk of new session
  const lastPrevChunk = prevChunks[prevChunks.length - 1];
  const edgeCount = await createCrossSessionEdges(lastPrevChunk.id, firstChunk.id);

  return {
    sessionId,
    previousSessionId: prevSessionInfo.sessionId,
    edgeCount,
    isContinuation: true,
  };
}

/**
 * Link all sessions in the database.
 * Run this after batch ingestion to create cross-session edges.
 */
export async function linkAllSessions(): Promise<{
  totalLinked: number;
  totalEdges: number;
  results: CrossSessionLinkResult[];
}> {
  const sessionIds = getSessionIds();
  const results: CrossSessionLinkResult[] = [];
  let totalEdges = 0;

  for (const sessionId of sessionIds) {
    const chunks = getChunksBySession(sessionId);
    if (chunks.length === 0) continue;

    const sessionSlug = chunks[0].sessionSlug;
    const result = await linkCrossSession(sessionId, sessionSlug);
    results.push(result);
    totalEdges += result.edgeCount;
  }

  const totalLinked = results.filter((r) => r.edgeCount > 0).length;

  return {
    totalLinked,
    totalEdges,
    results,
  };
}
