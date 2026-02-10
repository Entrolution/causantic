/**
 * Embedding cache for content-hash based caching.
 * Skips re-embedding unchanged content by caching embeddings keyed by content hash.
 */

import { createHash } from 'crypto';
import { getDb } from './db.js';
import { serializeEmbedding, deserializeEmbedding } from '../utils/embedding-utils.js';

/** Maximum cache entries before LRU eviction (~400MB for 1024-dim embeddings) */
const MAX_CACHE_ENTRIES = 100_000;

/** Extra entries to evict to avoid frequent evictions */
const EVICTION_BUFFER = 1_000;

/**
 * Compute a SHA-256 hash of content for cache lookup.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Get a cached embedding for a single content hash.
 * Returns null if not found. Updates hit count on cache hit.
 */
export function getCachedEmbedding(
  contentHash: string,
  modelId: string
): number[] | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT embedding FROM embedding_cache
    WHERE content_hash = ? AND model_id = ?
  `
    )
    .get(contentHash, modelId) as { embedding: Buffer } | undefined;

  if (!row) return null;

  // Update hit count (fire and forget)
  db.prepare(
    `
    UPDATE embedding_cache SET hit_count = hit_count + 1
    WHERE content_hash = ? AND model_id = ?
  `
  ).run(contentHash, modelId);

  // Deserialize from Buffer to number[]
  return deserializeEmbedding(row.embedding);
}

/**
 * Get cached embeddings for multiple content hashes in a single query.
 * Returns a Map of contentHash -> embedding for found entries.
 */
export function getCachedEmbeddingsBatch(
  contentHashes: string[],
  modelId: string
): Map<string, number[]> {
  const cache = new Map<string, number[]>();

  if (contentHashes.length === 0) return cache;

  const db = getDb();
  const placeholders = contentHashes.map(() => '?').join(',');
  const rows = db
    .prepare(
      `
    SELECT content_hash, embedding FROM embedding_cache
    WHERE content_hash IN (${placeholders}) AND model_id = ?
  `
    )
    .all(...contentHashes, modelId) as Array<{
    content_hash: string;
    embedding: Buffer;
  }>;

  for (const row of rows) {
    cache.set(row.content_hash, deserializeEmbedding(row.embedding));
  }

  // Update hit counts for found entries
  if (rows.length > 0) {
    const foundHashes = rows.map((r) => r.content_hash);
    const updatePlaceholders = foundHashes.map(() => '?').join(',');
    db.prepare(
      `
      UPDATE embedding_cache SET hit_count = hit_count + 1
      WHERE content_hash IN (${updatePlaceholders}) AND model_id = ?
    `
    ).run(...foundHashes, modelId);
  }

  return cache;
}

/**
 * Cache a single embedding.
 */
export function cacheEmbedding(
  contentHash: string,
  modelId: string,
  embedding: number[]
): void {
  const db = getDb();
  const blob = serializeEmbedding(embedding);

  db.prepare(
    `
    INSERT OR REPLACE INTO embedding_cache
    (content_hash, model_id, embedding, created_at, hit_count)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
  `
  ).run(contentHash, modelId, blob);
}

/**
 * Cache multiple embeddings in a single transaction.
 */
export function cacheEmbeddingsBatch(
  items: Array<{ contentHash: string; embedding: number[] }>,
  modelId: string
): void {
  if (items.length === 0) return;

  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO embedding_cache
    (content_hash, model_id, embedding, created_at, hit_count)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
  `);

  const insertMany = db.transaction(
    (items: Array<{ contentHash: string; embedding: number[] }>) => {
      for (const item of items) {
        const blob = serializeEmbedding(item.embedding);
        stmt.run(item.contentHash, modelId, blob);
      }
    }
  );

  insertMany(items);

  // Check if eviction is needed after batch insert
  evictOldestIfNeeded();
}

/**
 * Evict oldest cache entries if cache exceeds maximum size.
 * Uses LRU-like eviction based on created_at timestamp.
 */
export function evictOldestIfNeeded(): void {
  const db = getDb();
  const countResult = db
    .prepare('SELECT COUNT(*) as count FROM embedding_cache')
    .get() as { count: number };

  if (countResult.count > MAX_CACHE_ENTRIES) {
    const toEvict = countResult.count - MAX_CACHE_ENTRIES + EVICTION_BUFFER;
    db.prepare(
      `
      DELETE FROM embedding_cache WHERE rowid IN (
        SELECT rowid FROM embedding_cache
        ORDER BY created_at ASC
        LIMIT ?
      )
    `
    ).run(toEvict);
  }
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
  entryCount: number;
  totalHits: number;
  avgHitCount: number;
} {
  const db = getDb();
  const result = db
    .prepare(
      `
    SELECT COUNT(*) as count, COALESCE(SUM(hit_count), 0) as total_hits, COALESCE(AVG(hit_count), 0) as avg_hits
    FROM embedding_cache
  `
    )
    .get() as { count: number; total_hits: number; avg_hits: number };

  return {
    entryCount: result.count,
    totalHits: result.total_hits,
    avgHitCount: result.avg_hits,
  };
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  const db = getDb();
  db.prepare('DELETE FROM embedding_cache').run();
}

/**
 * Clear cache entries for a specific model.
 */
export function clearCacheForModel(modelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM embedding_cache WHERE model_id = ?').run(modelId);
}

