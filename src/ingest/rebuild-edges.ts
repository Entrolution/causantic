/**
 * Rebuild all edges using sequential linked-list structure.
 *
 * Reads existing stored chunks per session, deletes old edges,
 * and re-creates edges using the new sequential logic.
 * No re-parsing or re-embedding needed.
 */

import { getSessionIds, getChunksBySession } from '../storage/chunk-store.js';
import { deleteEdgesForSession } from '../storage/edge-store.js';
import { detectCausalTransitions } from './edge-detector.js';
import { createEdgesFromTransitions, createCrossSessionEdges } from './edge-creator.js';
import type { Chunk } from '../parser/types.js';
import type { StoredChunk } from '../storage/types.js';

export interface RebuildResult {
  sessionsProcessed: number;
  edgesDeleted: number;
  edgesCreated: number;
}

/**
 * Convert a stored chunk to the parser Chunk format for transition detection.
 */
function storedChunkToParserChunk(stored: StoredChunk): Chunk {
  return {
    id: stored.id,
    text: stored.content,
    metadata: {
      sessionId: stored.sessionId,
      sessionSlug: stored.sessionSlug,
      turnIndices: stored.turnIndices,
      startTime: stored.startTime,
      endTime: stored.endTime,
      codeBlockCount: stored.codeBlockCount,
      toolUseCount: stored.toolUseCount,
      hasThinking: false,
      renderMode: 'full',
      approxTokens: stored.approxTokens,
    },
  };
}

/**
 * Rebuild all edges across all sessions.
 */
export async function rebuildEdges(onProgress?: (msg: string) => void): Promise<RebuildResult> {
  const sessionIds = getSessionIds();
  let totalDeleted = 0;
  let totalCreated = 0;

  // Process sessions sorted by first chunk time
  const sessionChunks = new Map<string, StoredChunk[]>();
  for (const sessionId of sessionIds) {
    const chunks = getChunksBySession(sessionId);
    if (chunks.length > 0) {
      sessionChunks.set(sessionId, chunks);
    }
  }

  // Sort sessions by first chunk start_time for cross-session linking
  const sortedSessions = [...sessionChunks.entries()].sort((a, b) => {
    const timeA = a[1][0].startTime;
    const timeB = b[1][0].startTime;
    return timeA.localeCompare(timeB);
  });

  let processed = 0;
  for (const [sessionId, chunks] of sortedSessions) {
    processed++;
    onProgress?.(`[${processed}/${sortedSessions.length}] Session ${sessionId.slice(0, 8)}...`);

    const chunkIds = chunks.map((c) => c.id);

    // Delete old edges for this session
    const deleted = deleteEdgesForSession(chunkIds);
    totalDeleted += deleted;

    // Convert to parser Chunk format
    const parserChunks = chunks.map(storedChunkToParserChunk);

    // Detect transitions and create new edges
    const transitions = detectCausalTransitions(parserChunks);
    const edgeResult = await createEdgesFromTransitions(transitions, chunkIds);
    totalCreated += edgeResult.totalCount;
  }

  // Cross-session edges: link last chunk of session N to first chunk of session N+1
  // Group by project slug
  const projectSessions = new Map<string, Array<{ sessionId: string; chunks: StoredChunk[] }>>();
  for (const [sessionId, chunks] of sortedSessions) {
    const slug = chunks[0].sessionSlug;
    const list = projectSessions.get(slug) ?? [];
    list.push({ sessionId, chunks });
    projectSessions.set(slug, list);
  }

  for (const [slug, sessions] of projectSessions) {
    for (let i = 1; i < sessions.length; i++) {
      const prevChunks = sessions[i - 1].chunks;
      const currChunks = sessions[i].chunks;
      const lastChunkId = prevChunks[prevChunks.length - 1].id;
      const firstChunkId = currChunks[0].id;

      const count = await createCrossSessionEdges(lastChunkId, firstChunkId);
      totalCreated += count;
    }

    if (sessions.length > 1) {
      onProgress?.(`  Cross-session edges for ${slug}: ${sessions.length - 1} links`);
    }
  }

  return {
    sessionsProcessed: sortedSessions.length,
    edgesDeleted: totalDeleted,
    edgesCreated: totalCreated,
  };
}
