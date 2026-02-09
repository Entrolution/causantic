/**
 * Checkpoint store for incremental ingestion.
 * Tracks ingestion progress per session to enable resumption.
 */

import { getDb } from './db.js';

/**
 * Checkpoint data for a session's ingestion progress.
 */
export interface IngestionCheckpoint {
  sessionId: string;
  projectSlug: string;
  lastTurnIndex: number;
  lastChunkId: string | null;
  vectorClock: string | null;
  fileMtime: string | null;
  updatedAt: string;
}

/**
 * Get the ingestion checkpoint for a session.
 * Returns null if no checkpoint exists.
 */
export function getCheckpoint(sessionId: string): IngestionCheckpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT session_id, project_slug, last_turn_index, last_chunk_id, vector_clock, file_mtime, updated_at
    FROM ingestion_checkpoints WHERE session_id = ?
  `
    )
    .get(sessionId) as
    | {
        session_id: string;
        project_slug: string;
        last_turn_index: number;
        last_chunk_id: string | null;
        vector_clock: string | null;
        file_mtime: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    sessionId: row.session_id,
    projectSlug: row.project_slug,
    lastTurnIndex: row.last_turn_index,
    lastChunkId: row.last_chunk_id,
    vectorClock: row.vector_clock,
    fileMtime: row.file_mtime,
    updatedAt: row.updated_at,
  };
}

/**
 * Save or update an ingestion checkpoint.
 */
export function saveCheckpoint(
  checkpoint: Omit<IngestionCheckpoint, 'updatedAt'>
): void {
  const db = getDb();
  db.prepare(
    `
    INSERT OR REPLACE INTO ingestion_checkpoints
    (session_id, project_slug, last_turn_index, last_chunk_id, vector_clock, file_mtime, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `
  ).run(
    checkpoint.sessionId,
    checkpoint.projectSlug,
    checkpoint.lastTurnIndex,
    checkpoint.lastChunkId,
    checkpoint.vectorClock,
    checkpoint.fileMtime
  );
}

/**
 * Delete an ingestion checkpoint.
 */
export function deleteCheckpoint(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM ingestion_checkpoints WHERE session_id = ?').run(
    sessionId
  );
}

/**
 * Delete all checkpoints for a project.
 */
export function deleteProjectCheckpoints(projectSlug: string): void {
  const db = getDb();
  db.prepare('DELETE FROM ingestion_checkpoints WHERE project_slug = ?').run(
    projectSlug
  );
}

/**
 * Get all checkpoints for a project.
 */
export function getProjectCheckpoints(
  projectSlug: string
): IngestionCheckpoint[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT session_id, project_slug, last_turn_index, last_chunk_id, vector_clock, file_mtime, updated_at
    FROM ingestion_checkpoints WHERE project_slug = ?
  `
    )
    .all(projectSlug) as Array<{
    session_id: string;
    project_slug: string;
    last_turn_index: number;
    last_chunk_id: string | null;
    vector_clock: string | null;
    file_mtime: string | null;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    projectSlug: row.project_slug,
    lastTurnIndex: row.last_turn_index,
    lastChunkId: row.last_chunk_id,
    vectorClock: row.vector_clock,
    fileMtime: row.file_mtime,
    updatedAt: row.updated_at,
  }));
}
