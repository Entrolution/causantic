/**
 * Vector store cleanup and eviction logic.
 *
 * Extracted from VectorStore to separate TTL/eviction concerns from the
 * core vector storage and search responsibilities.
 *
 * These functions handle the DB-level operations (finding expired/excess
 * vectors, deleting them and their related data). The caller is responsible
 * for updating in-memory indexes after deletion.
 *
 * @module storage/vector-store-cleanup
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import { sqlPlaceholders, isTableNotFoundError } from './db.js';

/**
 * Remove vectors and all related data (chunks, clusters, index entries) by ID.
 *
 * Handles:
 * - Chunk deletion (FK cascades handle chunk_clusters and edges)
 * - Vector deletion from the specified table
 * - Orphaned cluster cleanup
 * - Orphaned index entry and index vector cleanup
 *
 * @param db - Database instance
 * @param tableName - Vector table name (e.g. 'vectors' or 'index_vectors')
 * @param ids - Vector/chunk IDs to remove
 * @returns Number of vectors deleted from the DB
 */
export function removeVectorsAndRelated(
  db: Database.Database,
  tableName: 'vectors' | 'index_vectors',
  ids: string[],
): number {
  const placeholders = sqlPlaceholders(ids.length);

  // Delete chunks first (FK cascades handle chunk_clusters and edges)
  db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...ids);

  // Delete vectors
  const result = db.prepare(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`).run(...ids);

  // Remove empty clusters (no remaining members after chunk deletion)
  db.prepare(
    `
    DELETE FROM clusters WHERE id NOT IN (
      SELECT DISTINCT cluster_id FROM chunk_clusters
    )
  `,
  ).run();

  // Clean up index entries that referenced the deleted chunks
  try {
    const placeholdersForCleanup = sqlPlaceholders(ids.length);
    db.prepare(`DELETE FROM index_entry_chunks WHERE chunk_id IN (${placeholdersForCleanup})`).run(
      ...ids,
    );

    // Delete orphaned index entries (no remaining chunk references)
    const orphaned = db
      .prepare(
        `SELECT id FROM index_entries WHERE id NOT IN (
        SELECT DISTINCT index_entry_id FROM index_entry_chunks
      )`,
      )
      .all() as Array<{ id: string }>;

    if (orphaned.length > 0) {
      const orphanIds = orphaned.map((r) => r.id);
      const orphanPlaceholders = sqlPlaceholders(orphanIds.length);
      db.prepare(`DELETE FROM index_entries WHERE id IN (${orphanPlaceholders})`).run(...orphanIds);

      // Remove from index vector store (if this is the chunk vector store)
      if (tableName === 'vectors') {
        db.prepare(`DELETE FROM index_vectors WHERE id IN (${orphanPlaceholders})`).run(
          ...orphanIds,
        );
      }
    }
  } catch (e) {
    if (!isTableNotFoundError(e)) throw e;
  }

  return result.changes;
}

/**
 * Find vector IDs that have expired based on their last_accessed timestamp.
 *
 * @param db - Database instance
 * @param tableName - Vector table name
 * @param ttlDays - Number of days after which unaccessed vectors expire
 * @returns Array of expired vector IDs
 */
export function findExpiredVectorIds(
  db: Database.Database,
  tableName: 'vectors' | 'index_vectors',
  ttlDays: number,
): string[] {
  const expiredRows = db
    .prepare(
      `
    SELECT id FROM ${tableName}
    WHERE last_accessed < datetime('now', '-' || ? || ' days')
  `,
    )
    .all(ttlDays) as { id: string }[];

  return expiredRows.map((r) => r.id);
}

/**
 * Find the oldest vector IDs that exceed a maximum count.
 *
 * @param db - Database instance
 * @param tableName - Vector table name
 * @param overage - Number of vectors to evict (currentCount - maxCount)
 * @returns Array of vector IDs to evict (oldest by last_accessed)
 */
export function findOldestVectorIds(
  db: Database.Database,
  tableName: 'vectors' | 'index_vectors',
  overage: number,
): string[] {
  const toEvict = db
    .prepare(
      `
    SELECT id FROM ${tableName}
    ORDER BY last_accessed ASC
    LIMIT ?
  `,
    )
    .all(overage) as { id: string }[];

  return toEvict.map((r) => r.id);
}
