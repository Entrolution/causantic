/**
 * CRUD operations for chunks.
 */

import { getDb, generateId } from './db.js';
import type { StoredChunk, ChunkInput } from './types.js';

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
      agent_id, spawn_depth, project_path
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
    chunk.spawnDepth ?? 0,
    chunk.projectPath ?? null,
  );

  invalidateProjectsCache();

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
      agent_id, spawn_depth, project_path
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
        chunk.spawnDepth ?? 0,
        chunk.projectPath ?? null,
      );
      ids.push(id);
    }
  });

  insertMany(chunks);
  invalidateProjectsCache();
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
  const rows = db
    .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
    .all(...ids) as DbChunkRow[];

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
  `,
    )
    .all(clusterId) as DbChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Check if a session has already been ingested.
 */
export function isSessionIngested(sessionId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM chunks WHERE session_id = ? LIMIT 1').get(sessionId) as
    | { 1: number }
    | undefined;

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
  const rows = db.prepare('SELECT DISTINCT session_id FROM chunks').all() as {
    session_id: string;
  }[];
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

/**
 * Get chunk IDs for a specific project slug.
 */
export function getChunkIdsByProject(projectSlug: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM chunks WHERE session_slug = ?').all(projectSlug) as {
    id: string;
  }[];
  return rows.map((r) => r.id);
}

/**
 * Project summary info.
 */
export interface ProjectInfo {
  slug: string;
  chunkCount: number;
  firstSeen: string;
  lastSeen: string;
}

/** Cached project list — invalidated on chunk insert. */
let cachedProjects: ProjectInfo[] | null = null;

/**
 * Invalidate the projects cache. Called after chunk inserts.
 */
export function invalidateProjectsCache(): void {
  cachedProjects = null;
}

/**
 * Get distinct projects with chunk counts and date ranges.
 * Results are cached at module level; cache invalidated on chunk insert.
 */
export function getDistinctProjects(): ProjectInfo[] {
  if (cachedProjects) return cachedProjects;

  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT
      session_slug AS slug,
      COUNT(*) AS chunkCount,
      MIN(start_time) AS firstSeen,
      MAX(start_time) AS lastSeen
    FROM chunks
    WHERE session_slug != ''
    GROUP BY session_slug
    ORDER BY lastSeen DESC
  `,
    )
    .all() as Array<{
    slug: string;
    chunkCount: number;
    firstSeen: string;
    lastSeen: string;
  }>;

  cachedProjects = rows;
  return rows;
}

/**
 * Session summary info.
 */
export interface SessionInfo {
  sessionId: string;
  firstChunkTime: string;
  lastChunkTime: string;
  chunkCount: number;
  totalTokens: number;
}

/**
 * Options for getChunksByTimeRange.
 */
export interface TimeRangeOptions {
  sessionId?: string;
  limit?: number;
}

/**
 * Get chunks for a project within a time range.
 * Uses the composite index on (session_slug, start_time).
 */
export function getChunksByTimeRange(
  project: string,
  from: string,
  to: string,
  opts?: TimeRangeOptions,
): StoredChunk[] {
  const db = getDb();

  let sql = `SELECT * FROM chunks WHERE session_slug = ? AND start_time >= ? AND start_time < ?`;
  const params: unknown[] = [project, from, to];

  if (opts?.sessionId) {
    sql += ' AND session_id = ?';
    params.push(opts.sessionId);
  }

  sql += ' ORDER BY start_time ASC';

  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  const rows = db.prepare(sql).all(...params) as DbChunkRow[];
  return rows.map(rowToChunk);
}

/**
 * List sessions for a project with aggregated metadata.
 * Optionally filtered by time range.
 */
export function getSessionsForProject(project: string, from?: string, to?: string): SessionInfo[] {
  const db = getDb();

  let sql = `
    SELECT
      session_id AS sessionId,
      MIN(start_time) AS firstChunkTime,
      MAX(end_time) AS lastChunkTime,
      COUNT(*) AS chunkCount,
      COALESCE(SUM(approx_tokens), 0) AS totalTokens
    FROM chunks
    WHERE session_slug = ?
  `;
  const params: unknown[] = [project];

  if (from) {
    sql += ' AND start_time >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND start_time < ?';
    params.push(to);
  }

  sql += ' GROUP BY session_id ORDER BY firstChunkTime DESC';

  return db.prepare(sql).all(...params) as SessionInfo[];
}

/**
 * Find the most recent session before a given session.
 * Uses the composite index for efficient lookup.
 */
export function getPreviousSession(project: string, currentSessionId: string): SessionInfo | null {
  const db = getDb();

  // Get the current session's earliest start_time
  const current = db
    .prepare(
      'SELECT MIN(start_time) AS minTime FROM chunks WHERE session_id = ? AND session_slug = ?',
    )
    .get(currentSessionId, project) as { minTime: string | null } | undefined;

  if (!current?.minTime) return null;

  // Find the latest session that ended before the current session started
  const row = db
    .prepare(
      `
      SELECT
        session_id AS sessionId,
        MIN(start_time) AS firstChunkTime,
        MAX(end_time) AS lastChunkTime,
        COUNT(*) AS chunkCount,
        COALESCE(SUM(approx_tokens), 0) AS totalTokens
      FROM chunks
      WHERE session_slug = ?
        AND session_id != ?
        AND end_time <= ?
      GROUP BY session_id
      ORDER BY lastChunkTime DESC
      LIMIT 1
    `,
    )
    .get(project, currentSessionId, current.minTime) as SessionInfo | undefined;

  return row ?? null;
}

/**
 * Filters for querying chunk IDs (used by forget tool).
 */
export interface ChunkQueryFilters {
  project: string;
  before?: string;
  after?: string;
  sessionId?: string;
}

/**
 * Query chunk IDs matching the given filters.
 * Project is always required; time and session filters are optional.
 */
export function queryChunkIds(filters: ChunkQueryFilters): string[] {
  const db = getDb();

  let sql = 'SELECT id FROM chunks WHERE session_slug = ?';
  const params: unknown[] = [filters.project];

  if (filters.before) {
    sql += ' AND start_time < ?';
    params.push(filters.before);
  }
  if (filters.after) {
    sql += ' AND start_time >= ?';
    params.push(filters.after);
  }
  if (filters.sessionId) {
    sql += ' AND session_id = ?';
    params.push(filters.sessionId);
  }

  const rows = db.prepare(sql).all(...params) as { id: string }[];
  return rows.map((r) => r.id);
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
  agent_id: string | null;
  spawn_depth: number | null;
  project_path: string | null;
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
    spawnDepth: row.spawn_depth ?? 0,
    projectPath: row.project_path,
  };
}
