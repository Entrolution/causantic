/**
 * CRUD operations for session_states table.
 *
 * Stores structured session state extracted during ingestion:
 * files touched, errors, outcomes, tasks, and optional LLM summary.
 */

import { getDb } from './db.js';
import type { SessionState } from '../ingest/session-state.js';

/** A stored session state row. */
export interface StoredSessionState {
  sessionId: string;
  sessionSlug: string;
  projectPath: string | null;
  endedAt: string;
  filesTouched: string[];
  errors: Array<{ tool: string; message: string; resolution?: string }>;
  outcomes: string[];
  tasks: Array<{ description: string; status: string }>;
  summary: string | null;
  createdAt: string;
}

/** Row shape from SQLite (JSON columns as strings). */
interface DbSessionStateRow {
  session_id: string;
  session_slug: string;
  project_path: string | null;
  ended_at: string;
  files_touched: string;
  errors: string;
  outcomes: string;
  tasks: string;
  summary: string | null;
  created_at: string;
}

/**
 * Convert a DB row to a StoredSessionState.
 */
function rowToSessionState(row: DbSessionStateRow): StoredSessionState {
  return {
    sessionId: row.session_id,
    sessionSlug: row.session_slug,
    projectPath: row.project_path,
    endedAt: row.ended_at,
    filesTouched: JSON.parse(row.files_touched),
    errors: JSON.parse(row.errors),
    outcomes: JSON.parse(row.outcomes),
    tasks: JSON.parse(row.tasks),
    summary: row.summary,
    createdAt: row.created_at,
  };
}

/**
 * Upsert a session state record.
 */
export function upsertSessionState(
  sessionId: string,
  sessionSlug: string,
  projectPath: string | null,
  endedAt: string,
  state: SessionState,
  summary?: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO session_states (
      session_id, session_slug, project_path, ended_at,
      files_touched, errors, outcomes, tasks, summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    sessionSlug,
    projectPath,
    endedAt,
    JSON.stringify(state.filesTouched),
    JSON.stringify(state.errors),
    JSON.stringify(state.outcomes),
    JSON.stringify(state.tasks),
    summary ?? null,
  );
}

/**
 * Get session state by session ID.
 */
export function getSessionState(sessionId: string): StoredSessionState | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM session_states WHERE session_id = ?').get(sessionId) as
    | DbSessionStateRow
    | undefined;

  return row ? rowToSessionState(row) : null;
}

/**
 * Get recent session states for a project, ordered by ended_at descending.
 */
export function getRecentSessionStates(
  project: string,
  limit: number = 5,
): StoredSessionState[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM session_states WHERE session_slug = ? ORDER BY ended_at DESC LIMIT ?',
  ).all(project, limit) as DbSessionStateRow[];

  return rows.map(rowToSessionState);
}

/**
 * Get session states within a time range for a project.
 */
export function getSessionStatesByTimeRange(
  project: string,
  from: string,
  to: string,
): StoredSessionState[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM session_states WHERE session_slug = ? AND ended_at >= ? AND ended_at <= ? ORDER BY ended_at ASC',
  ).all(project, from, to) as DbSessionStateRow[];

  return rows.map(rowToSessionState);
}

/**
 * Delete session state for a session.
 */
export function deleteSessionState(sessionId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM session_states WHERE session_id = ?').run(sessionId);
  return result.changes > 0;
}

/**
 * Delete all session states for a project.
 */
export function deleteSessionStatesForProject(project: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM session_states WHERE session_slug = ?').run(project);
  return result.changes;
}

/**
 * Count session states for a project.
 */
export function countSessionStates(project?: string): number {
  const db = getDb();
  if (project) {
    return (
      db.prepare('SELECT COUNT(*) as count FROM session_states WHERE session_slug = ?').get(project) as { count: number }
    ).count;
  }
  return (
    db.prepare('SELECT COUNT(*) as count FROM session_states').get() as { count: number }
  ).count;
}
