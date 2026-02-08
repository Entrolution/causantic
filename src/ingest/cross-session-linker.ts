/**
 * Cross-session edge detection and creation.
 * Detects continued sessions and creates edges across session boundaries.
 */

import { getChunksBySession, getSessionIds } from '../storage/chunk-store.js';
import { createCrossSessionEdges } from './edge-creator.js';
import type { StoredChunk } from '../storage/types.js';

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
 * Check if a session is a continuation of a previous session.
 */
export function isContinuedSession(firstChunkContent: string): boolean {
  return CONTINUATION_PATTERNS.some((p) => p.test(firstChunkContent));
}

/**
 * Link a session to its previous session if it's a continuation.
 *
 * @param sessionId - Session ID to check
 * @param sessionSlug - Session slug (project identifier)
 * @returns Link result
 */
export async function linkCrossSession(
  sessionId: string,
  sessionSlug: string
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

  // Find previous session for this project
  const previousSession = await findPreviousSession(
    sessionSlug,
    firstChunk.startTime,
    sessionId
  );

  if (!previousSession) {
    return {
      sessionId,
      previousSessionId: null,
      edgeCount: 0,
      isContinuation: true, // Continuation detected but no previous session found
    };
  }

  // Get final chunks from previous session
  const prevChunks = getChunksBySession(previousSession.sessionId);
  const finalChunks = prevChunks.slice(-3); // Last 3 chunks

  if (finalChunks.length === 0) {
    return {
      sessionId,
      previousSessionId: previousSession.sessionId,
      edgeCount: 0,
      isContinuation: true,
    };
  }

  // Create cross-session edges
  const edgeCount = await createCrossSessionEdges(
    finalChunks.map((c) => c.id),
    firstChunk.id
  );

  return {
    sessionId,
    previousSessionId: previousSession.sessionId,
    edgeCount,
    isContinuation: true,
  };
}

/**
 * Find the most recent previous session for a project.
 */
async function findPreviousSession(
  sessionSlug: string,
  beforeTime: string,
  excludeSessionId: string
): Promise<StoredChunk | null> {
  // Get all session IDs
  const allSessionIds = getSessionIds();

  let latestChunk: StoredChunk | null = null;
  let latestTime = 0;

  for (const sid of allSessionIds) {
    if (sid === excludeSessionId) continue;

    const chunks = getChunksBySession(sid);
    if (chunks.length === 0) continue;

    // Check if this session is for the same project
    if (chunks[0].sessionSlug !== sessionSlug) continue;

    // Find the last chunk's end time
    const lastChunk = chunks[chunks.length - 1];
    const endTime = new Date(lastChunk.endTime).getTime();
    const beforeTimeMs = new Date(beforeTime).getTime();

    // Must be before the target session
    if (endTime >= beforeTimeMs) continue;

    // Track the most recent
    if (endTime > latestTime) {
      latestTime = endTime;
      latestChunk = lastChunk;
    }
  }

  return latestChunk;
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
