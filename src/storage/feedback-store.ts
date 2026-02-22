/**
 * Retrieval feedback store.
 *
 * Records which chunks are returned in retrieval results and computes
 * feedback scores for relevance learning. Scores use log2(1 + count)
 * for diminishing returns — avoids runaway popularity bias.
 */

import { createHash } from 'crypto';
import { getDb } from './db.js';

/**
 * Compute a short hash of a query string for grouping.
 * First 8 chars of SHA-256 — collisions acceptable since scoring aggregates by chunk_id.
 */
function queryHash(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 8);
}

/**
 * Record that chunks were returned in a retrieval result.
 * One row per chunk. Fire-and-forget — caller should not await this in the hot path.
 */
export function recordRetrieval(chunkIds: string[], query: string, toolName: string): void {
  if (chunkIds.length === 0) return;

  const db = getDb();
  const hash = queryHash(query);

  const stmt = db.prepare(
    'INSERT INTO retrieval_feedback (chunk_id, query_hash, tool_name) VALUES (?, ?, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const chunkId of chunkIds) {
      stmt.run(chunkId, hash, toolName);
    }
  });

  insertAll();
}

/**
 * Get feedback scores for a set of chunk IDs.
 * Score = log2(1 + returnCount) — diminishing returns to prevent runaway popularity.
 *
 * @returns Map of chunkId → score (only chunks with feedback are included)
 */
export function getFeedbackScores(chunkIds: string[]): Map<string, number> {
  if (chunkIds.length === 0) return new Map();

  const db = getDb();
  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT chunk_id, COUNT(*) as cnt FROM retrieval_feedback WHERE chunk_id IN (${placeholders}) GROUP BY chunk_id`,
    )
    .all(...chunkIds) as Array<{ chunk_id: string; cnt: number }>;

  const scores = new Map<string, number>();
  for (const row of rows) {
    scores.set(row.chunk_id, Math.log2(1 + row.cnt));
  }

  return scores;
}

/**
 * Get the most frequently returned chunks for a project.
 * Useful for debugging and understanding retrieval patterns.
 */
export function getPopularChunks(limit: number = 10): Array<{ chunkId: string; count: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT chunk_id, COUNT(*) as cnt FROM retrieval_feedback GROUP BY chunk_id ORDER BY cnt DESC LIMIT ?',
    )
    .all(limit) as Array<{ chunk_id: string; cnt: number }>;

  return rows.map((r) => ({ chunkId: r.chunk_id, count: r.cnt }));
}

// Re-export for testing
export { queryHash as _queryHash };
