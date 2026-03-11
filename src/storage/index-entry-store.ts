/**
 * CRUD operations for semantic index entries.
 *
 * Index entries are LLM-compressed, normalised-length descriptions of chunks.
 * They form the search layer: queries match against index entries, then
 * dereference to underlying chunks for full content.
 *
 * Follows the chunk-store pattern: function-based API, transaction support,
 * snake_case DB ↔ camelCase code mapping.
 */

import { getDb, generateId, sqlPlaceholders } from './db.js';
import { indexVectorStore } from './vector-store.js';
import type { IndexEntry, IndexEntryInput } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('index-entry-store');

/** Database row shape (snake_case). */
interface DbIndexEntryRow {
  id: string;
  chunk_ids: string;
  session_slug: string;
  start_time: string;
  description: string;
  approx_tokens: number;
  agent_id: string | null;
  team_name: string | null;
  generation_method: string;
  created_at: string;
}

/** Map a DB row to the IndexEntry type. */
function rowToEntry(row: DbIndexEntryRow): IndexEntry {
  return {
    id: row.id,
    chunkIds: JSON.parse(row.chunk_ids) as string[],
    sessionSlug: row.session_slug,
    startTime: row.start_time,
    description: row.description,
    approxTokens: row.approx_tokens,
    agentId: row.agent_id,
    teamName: row.team_name,
    generationMethod: row.generation_method as 'heuristic' | 'llm' | 'jeopardy',
    createdAt: row.created_at,
  };
}

/**
 * Insert a single index entry. Returns the generated ID.
 */
export function insertIndexEntry(input: IndexEntryInput): string {
  const db = getDb();
  const id = generateId();

  db.prepare(
    `INSERT INTO index_entries (id, chunk_ids, session_slug, start_time, description, approx_tokens, agent_id, team_name, generation_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    JSON.stringify(input.chunkIds),
    input.sessionSlug,
    input.startTime,
    input.description,
    input.approxTokens,
    input.agentId ?? null,
    input.teamName ?? null,
    input.generationMethod,
  );

  // Populate reverse lookup
  const iecStmt = db.prepare(
    'INSERT OR IGNORE INTO index_entry_chunks (index_entry_id, chunk_id) VALUES (?, ?)',
  );
  for (const chunkId of input.chunkIds) {
    iecStmt.run(id, chunkId);
  }

  return id;
}

/**
 * Insert multiple index entries in a transaction. Returns generated IDs.
 */
export function insertIndexEntries(inputs: IndexEntryInput[]): string[] {
  if (inputs.length === 0) return [];

  const db = getDb();
  const ids: string[] = [];

  const entryStmt = db.prepare(
    `INSERT INTO index_entries (id, chunk_ids, session_slug, start_time, description, approx_tokens, agent_id, team_name, generation_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const iecStmt = db.prepare(
    'INSERT OR IGNORE INTO index_entry_chunks (index_entry_id, chunk_id) VALUES (?, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const input of inputs) {
      const id = generateId();
      ids.push(id);

      entryStmt.run(
        id,
        JSON.stringify(input.chunkIds),
        input.sessionSlug,
        input.startTime,
        input.description,
        input.approxTokens,
        input.agentId ?? null,
        input.teamName ?? null,
        input.generationMethod,
      );

      for (const chunkId of input.chunkIds) {
        iecStmt.run(id, chunkId);
      }
    }
  });

  insertAll();
  return ids;
}

/**
 * Get an index entry by ID.
 */
export function getIndexEntryById(id: string): IndexEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM index_entries WHERE id = ?').get(id) as
    | DbIndexEntryRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

/**
 * Get index entries by their IDs.
 */
export function getIndexEntriesByIds(ids: string[]): IndexEntry[] {
  if (ids.length === 0) return [];

  const db = getDb();
  const placeholders = sqlPlaceholders(ids.length);
  const rows = db
    .prepare(`SELECT * FROM index_entries WHERE id IN (${placeholders})`)
    .all(...ids) as DbIndexEntryRow[];

  return rows.map(rowToEntry);
}

/**
 * Get index entries for a specific chunk ID (reverse lookup).
 */
export function getIndexEntriesForChunk(chunkId: string): IndexEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ie.* FROM index_entries ie
       JOIN index_entry_chunks iec ON ie.id = iec.index_entry_id
       WHERE iec.chunk_id = ?`,
    )
    .all(chunkId) as DbIndexEntryRow[];

  return rows.map(rowToEntry);
}

/**
 * Get all index entries for a session slug.
 */
export function getIndexEntriesBySession(sessionSlug: string): IndexEntry[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM index_entries WHERE session_slug = ? ORDER BY start_time')
    .all(sessionSlug) as DbIndexEntryRow[];

  return rows.map(rowToEntry);
}

/**
 * Get total count of index entries.
 */
export function getIndexEntryCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM index_entries').get() as { count: number };
  return row.count;
}

/**
 * Get count of chunk IDs that have index entries.
 */
export function getIndexedChunkCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(DISTINCT chunk_id) as count FROM index_entry_chunks').get() as {
    count: number;
  };
  return row.count;
}

/**
 * Get chunk IDs that do NOT have index entries (for backfill).
 */
export function getUnindexedChunkIds(limit: number): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id FROM chunks c
       LEFT JOIN index_entry_chunks iec ON c.id = iec.chunk_id
       WHERE iec.chunk_id IS NULL
       ORDER BY c.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: string }>;

  return rows.map((r) => r.id);
}

/**
 * Delete an index entry and its reverse-lookup rows.
 * Also removes the corresponding vector from the index vector store.
 */
export async function deleteIndexEntry(id: string): Promise<boolean> {
  const db = getDb();

  const result = db.transaction(() => {
    db.prepare('DELETE FROM index_entry_chunks WHERE index_entry_id = ?').run(id);
    return db.prepare('DELETE FROM index_entries WHERE id = ?').run(id);
  })();

  if (result.changes > 0) {
    await indexVectorStore.delete(id);
    return true;
  }
  return false;
}

/**
 * Delete index entries for specific chunk IDs.
 * Cleans up entries that have no remaining chunk references.
 */
export async function deleteIndexEntriesForChunks(chunkIds: string[]): Promise<number> {
  if (chunkIds.length === 0) return 0;

  const db = getDb();
  const placeholders = sqlPlaceholders(chunkIds.length);

  // Find affected index entry IDs
  const affectedRows = db
    .prepare(
      `SELECT DISTINCT index_entry_id FROM index_entry_chunks WHERE chunk_id IN (${placeholders})`,
    )
    .all(...chunkIds) as Array<{ index_entry_id: string }>;

  if (affectedRows.length === 0) return 0;

  const affectedIds = affectedRows.map((r) => r.index_entry_id);

  // Remove the chunk references
  db.prepare(
    `DELETE FROM index_entry_chunks WHERE chunk_id IN (${placeholders})`,
  ).run(...chunkIds);

  // Find entries that now have no chunk references
  const orphanedIds: string[] = [];
  for (const entryId of affectedIds) {
    const remaining = db
      .prepare('SELECT COUNT(*) as count FROM index_entry_chunks WHERE index_entry_id = ?')
      .get(entryId) as { count: number };

    if (remaining.count === 0) {
      orphanedIds.push(entryId);
    } else {
      // Update the chunk_ids JSON to reflect removed references
      const currentChunks = db
        .prepare('SELECT chunk_id FROM index_entry_chunks WHERE index_entry_id = ?')
        .all(entryId) as Array<{ chunk_id: string }>;

      db.prepare('UPDATE index_entries SET chunk_ids = ? WHERE id = ?').run(
        JSON.stringify(currentChunks.map((c) => c.chunk_id)),
        entryId,
      );
    }
  }

  // Delete orphaned entries
  if (orphanedIds.length > 0) {
    const orphanPlaceholders = sqlPlaceholders(orphanedIds.length);
    db.prepare(
      `DELETE FROM index_entries WHERE id IN (${orphanPlaceholders})`,
    ).run(...orphanedIds);

    // Clean up vectors
    await indexVectorStore.deleteBatch(orphanedIds);
  }

  return orphanedIds.length;
}

/**
 * Dereference index entry IDs to their underlying chunk IDs.
 * Returns a deduplicated array of chunk IDs preserving the order
 * of the input index entry IDs.
 */
export function dereferenceToChunkIds(indexEntryIds: string[]): string[] {
  if (indexEntryIds.length === 0) return [];

  const db = getDb();
  const placeholders = sqlPlaceholders(indexEntryIds.length);

  const rows = db
    .prepare(
      `SELECT chunk_ids FROM index_entries WHERE id IN (${placeholders})`,
    )
    .all(...indexEntryIds) as Array<{ chunk_ids: string }>;

  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of rows) {
    const ids = JSON.parse(row.chunk_ids) as string[];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  return result;
}

/**
 * Keyword search on index entry descriptions using FTS5.
 */
export function searchIndexEntriesByKeyword(
  query: string,
  limit: number,
  projectFilter?: string | string[],
  agentFilter?: string,
): Array<{ id: string; score: number }> {
  const db = getDb();

  // Sanitize query for FTS5
  const sanitized = query
    .replace(/\b(AND|OR|NOT)\b/g, '')
    .replace(/[*"(){}\^~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return [];

  const terms = sanitized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const ftsQuery = terms.map((t) => `"${t}"`).join(' ');

  try {
    let sql = `
      SELECT ie.id, bm25(index_entries_fts) as score
      FROM index_entries_fts
      JOIN index_entries ie ON ie.rowid = index_entries_fts.rowid
      WHERE index_entries_fts MATCH ?`;
    const params: unknown[] = [ftsQuery];

    if (projectFilter) {
      const projects = Array.isArray(projectFilter) ? projectFilter : [projectFilter];
      const placeholders = sqlPlaceholders(projects.length);
      sql += ` AND ie.session_slug IN (${placeholders})`;
      params.push(...projects);
    }

    if (agentFilter) {
      sql += ' AND ie.agent_id = ?';
      params.push(agentFilter);
    }

    sql += ' ORDER BY bm25(index_entries_fts) LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<{ id: string; score: number }>;

    return rows.map((r) => ({
      id: r.id,
      score: -r.score, // bm25 returns negative scores
    }));
  } catch (error) {
    log.warn('Index entry keyword search failed', { error: (error as Error).message });
    return [];
  }
}
