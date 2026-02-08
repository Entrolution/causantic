/**
 * Persistence layer for vector clocks.
 *
 * Stores and retrieves vector clocks from SQLite for:
 * - Reference clocks (per project): Element-wise max of all agent clocks
 * - Agent clocks (per project + agent): Current clock state for each agent
 */

import { getDb } from './db.js';
import {
  type VectorClock,
  serialize,
  deserialize,
  merge,
  createClock,
} from '../temporal/vector-clock.js';

/**
 * Get the reference clock for a project.
 * The reference clock is the element-wise max of all agent clocks,
 * representing the "current time" for decay calculation.
 *
 * @param projectSlug - Project identifier
 * @returns Current reference clock (empty if none stored)
 */
export function getReferenceClock(projectSlug: string): VectorClock {
  const db = getDb();

  const row = db
    .prepare('SELECT clock_data FROM vector_clocks WHERE id = ? AND project_slug = ?')
    .get(`project:${projectSlug}`, projectSlug) as { clock_data: string } | undefined;

  return row ? deserialize(row.clock_data) : createClock();
}

/**
 * Set the reference clock for a project.
 *
 * @param projectSlug - Project identifier
 * @param clock - New reference clock
 */
export function setReferenceClock(projectSlug: string, clock: VectorClock): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      clock_data = excluded.clock_data,
      updated_at = CURRENT_TIMESTAMP
  `).run(`project:${projectSlug}`, projectSlug, serialize(clock));
}

/**
 * Get the clock for a specific agent within a project.
 *
 * @param projectSlug - Project identifier
 * @param agentId - Agent identifier (e.g., 'ui', 'human', or sub-agent ID)
 * @returns Agent's current clock (empty if none stored)
 */
export function getAgentClock(projectSlug: string, agentId: string): VectorClock {
  const db = getDb();

  const row = db
    .prepare('SELECT clock_data FROM vector_clocks WHERE id = ? AND project_slug = ?')
    .get(`agent:${projectSlug}:${agentId}`, projectSlug) as { clock_data: string } | undefined;

  return row ? deserialize(row.clock_data) : createClock();
}

/**
 * Update the clock for a specific agent and refresh the reference clock.
 * The reference clock is automatically updated to be the merge of all agent clocks.
 *
 * @param projectSlug - Project identifier
 * @param agentId - Agent identifier
 * @param clock - New clock state for this agent
 */
export function updateAgentClock(projectSlug: string, agentId: string, clock: VectorClock): void {
  const db = getDb();

  // Store the agent's clock
  db.prepare(`
    INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      clock_data = excluded.clock_data,
      updated_at = CURRENT_TIMESTAMP
  `).run(`agent:${projectSlug}:${agentId}`, projectSlug, serialize(clock));

  // Update reference clock (merge with existing)
  const currentRef = getReferenceClock(projectSlug);
  const newRef = merge(currentRef, clock);
  setReferenceClock(projectSlug, newRef);
}

/**
 * Get all agent clocks for a project.
 *
 * @param projectSlug - Project identifier
 * @returns Map of agentId → clock
 */
export function getAllAgentClocks(projectSlug: string): Map<string, VectorClock> {
  const db = getDb();

  const rows = db
    .prepare('SELECT id, clock_data FROM vector_clocks WHERE project_slug = ? AND id LIKE ?')
    .all(projectSlug, `agent:${projectSlug}:%`) as Array<{ id: string; clock_data: string }>;

  const result = new Map<string, VectorClock>();
  const prefix = `agent:${projectSlug}:`;

  for (const row of rows) {
    if (row.id.startsWith(prefix)) {
      const agentId = row.id.slice(prefix.length);
      result.set(agentId, deserialize(row.clock_data));
    }
  }

  return result;
}

/**
 * Rebuild the reference clock from all agent clocks.
 * Useful after data recovery or manual edits.
 *
 * @param projectSlug - Project identifier
 * @returns The newly computed reference clock
 */
export function rebuildReferenceClock(projectSlug: string): VectorClock {
  const agentClocks = getAllAgentClocks(projectSlug);
  let ref = createClock();

  for (const clock of agentClocks.values()) {
    ref = merge(ref, clock);
  }

  setReferenceClock(projectSlug, ref);
  return ref;
}

/**
 * Delete all clocks for a project.
 * Used when clearing project data.
 *
 * @param projectSlug - Project identifier
 * @returns Number of records deleted
 */
export function deleteProjectClocks(projectSlug: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM vector_clocks WHERE project_slug = ?').run(projectSlug);
  return result.changes;
}

/**
 * Get the last update time for a clock.
 *
 * @param projectSlug - Project identifier
 * @param agentId - Agent identifier (optional, for reference clock if omitted)
 * @returns ISO timestamp of last update, or null if not found
 */
export function getClockUpdateTime(projectSlug: string, agentId?: string): string | null {
  const db = getDb();
  const id = agentId ? `agent:${projectSlug}:${agentId}` : `project:${projectSlug}`;

  const row = db
    .prepare('SELECT updated_at FROM vector_clocks WHERE id = ?')
    .get(id) as { updated_at: string } | undefined;

  return row?.updated_at ?? null;
}

/**
 * Check if a project has any stored clocks.
 *
 * @param projectSlug - Project identifier
 * @returns true if project has stored clocks
 */
export function hasProjectClocks(projectSlug: string): boolean {
  const db = getDb();

  const row = db
    .prepare('SELECT 1 FROM vector_clocks WHERE project_slug = ? LIMIT 1')
    .get(projectSlug);

  return row !== undefined;
}
