/**
 * CRUD operations for chunks.
 */

import { getDb, generateId } from './db.js';
import type { StoredChunk, ChunkInput } from './types.js';
import { serialize, deserialize } from '../temporal/vector-clock.js';

/**
 * Insert a single chunk.
 */
export function insertChunk(chunk: ChunkInput): string {
  const db = getDb();
  const id = chunk.id || generateId();

  const stmt = db.prepare(`
    INSERT INTO chunks (
      id, session_id, session_slug, turn_indices, start_time, end_time,
      content, code_block_count, tool_use_count, approx_tokens,
      agent_id, vector_clock, spawn_depth
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    chunk.sessionId,
    chunk.sessionSlug,
    JSON.stringify(chunk.turnIndices),
    chunk.startTime,
    chunk.endTime,
    chunk.content,
    chunk.codeBlockCount,
    chunk.toolUseCount,
    chunk.approxTokens,
    chunk.agentId ?? null,
    chunk.vectorClock ? serialize(chunk.vectorClock) : null,
    chunk.spawnDepth ?? 0
  );

  return id;
}

/**
 * Insert multiple chunks in a transaction.
 */
export function insertChunks(chunks: ChunkInput[]): string[] {
  const db = getDb();
  const ids: string[] = [];

  const stmt = db.prepare(`
    INSERT INTO chunks (
      id, session_id, session_slug, turn_indices, start_time, end_time,
      content, code_block_count, tool_use_count, approx_tokens,
      agent_id, vector_clock, spawn_depth
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((chunks: ChunkInput[]) => {
    for (const chunk of chunks) {
      const id = chunk.id || generateId();
      stmt.run(
        id,
        chunk.sessionId,
        chunk.sessionSlug,
        JSON.stringify(chunk.turnIndices),
        chunk.startTime,
        chunk.endTime,
        chunk.content,
        chunk.codeBlockCount,
        chunk.toolUseCount,
        chunk.approxTokens,
        chunk.agentId ?? null,
        chunk.vectorClock ? serialize(chunk.vectorClock) : null,
        chunk.spawnDepth ?? 0
      );
      ids.push(id);
    }
  });

  insertMany(chunks);
  return ids;
}

/**
 * Get a chunk by ID.
 */
export function getChunkById(id: string): StoredChunk | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as DbChunkRow | undefined;

  if (!row) {
    return null;
  }

  return rowToChunk(row);
}

/**
 * Get multiple chunks by ID.
 */
export function getChunksByIds(ids: string[]): StoredChunk[] {
  if (ids.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`).all(...ids) as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Get all chunks for a session.
 */
export function getChunksBySession(sessionId: string): StoredChunk[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM chunks WHERE session_id = ? ORDER BY start_time')
    .all(sessionId) as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Get all chunks for a session by slug.
 */
export function getChunksBySessionSlug(sessionSlug: string): StoredChunk[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM chunks WHERE session_slug = ? ORDER BY start_time')
    .all(sessionSlug) as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Get all chunks.
 */
export function getAllChunks(): StoredChunk[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM chunks ORDER BY start_time').all() as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Get chunks by cluster.
 */
export function getChunksByCluster(clusterId: string): StoredChunk[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT c.* FROM chunks c
    JOIN chunk_clusters cc ON c.id = cc.chunk_id
    WHERE cc.cluster_id = ?
    ORDER BY cc.distance
  `
    )
    .all(clusterId) as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Check if a session has already been ingested.
 */
export function isSessionIngested(sessionId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 FROM chunks WHERE session_id = ? LIMIT 1')
    .get(sessionId) as { 1: number } | undefined;

  return row !== undefined;
}

/**
 * Delete a chunk by ID.
 */
export function deleteChunk(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chunks WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete multiple chunks by ID.
 */
export function deleteChunks(ids: string[]): number {
  if (ids.length === 0) {
    return 0;
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

/**
 * Get unique session IDs.
 */
export function getSessionIds(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT session_id FROM chunks').all() as { session_id: string }[];
  return rows.map((r) => r.session_id);
}

/**
 * Get chunk count.
 */
export function getChunkCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
  return row.count;
}

// Internal types and helpers

interface DbChunkRow {
  id: string;
  session_id: string;
  session_slug: string;
  turn_indices: string;
  start_time: string;
  end_time: string;
  content: string;
  code_block_count: number;
  tool_use_count: number;
  approx_tokens: number;
  created_at: string;
  // v2: Vector clock support
  agent_id: string | null;
  vector_clock: string | null;
  spawn_depth: number | null;
}

function rowToChunk(row: DbChunkRow): StoredChunk {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionSlug: row.session_slug,
    turnIndices: JSON.parse(row.turn_indices) as number[],
    startTime: row.start_time,
    endTime: row.end_time,
    content: row.content,
    codeBlockCount: row.code_block_count,
    toolUseCount: row.tool_use_count,
    approxTokens: row.approx_tokens,
    createdAt: row.created_at,
    agentId: row.agent_id,
    vectorClock: row.vector_clock ? deserialize(row.vector_clock) : null,
    spawnDepth: row.spawn_depth ?? 0,
  };
}
