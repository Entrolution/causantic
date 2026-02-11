/**
 * In-memory vector store with SQLite persistence.
 *
 * Provides vector similarity search for chunk embeddings using angular distance.
 * Embeddings are stored as Float32Array blobs in SQLite and loaded into memory
 * on first access for fast brute-force search.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                     VectorStore                             │
 * │  ┌─────────────────────┐    ┌─────────────────────────────┐ │
 * │  │  In-Memory Index    │    │    SQLite Persistence       │ │
 * │  │  Map<id, number[]>  │ ◄──┤  vectors (id, embedding,    │ │
 * │  └─────────────────────┘    │           last_accessed)    │ │
 * │                             └─────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## TTL (Time To Live)
 *
 * Vectors have a `last_accessed` timestamp that is updated when they are
 * returned from search. Vectors that haven't been accessed within the TTL
 * period can be cleaned up by the maintenance task.
 *
 * This allows vectors to persist for semantic search even after their
 * associated chunks are pruned from the causal graph, while still eventually
 * cleaning up truly stale vectors.
 *
 * ## Usage
 *
 * ```typescript
 * import { vectorStore } from './vector-store.js';
 *
 * // Insert an embedding
 * await vectorStore.insert('chunk-123', embedding);
 *
 * // Search for similar vectors
 * const results = await vectorStore.search(queryEmbedding, 10);
 * // Returns: [{ id: 'chunk-456', distance: 0.15 }, ...]
 * // (also updates last_accessed for returned vectors)
 * ```
 *
 * ## Distance Metric
 *
 * Uses angular distance (0 = identical, 2 = opposite):
 * - `0.0`: Identical vectors
 * - `0.5`: ~60° angle
 * - `1.0`: Orthogonal (90°)
 * - `2.0`: Opposite vectors
 *
 * ## Performance Notes
 *
 * - Initial load: O(n) to deserialize all vectors from SQLite
 * - Insert: O(1) amortized (memory + single row insert)
 * - Search: O(n) brute-force (sufficient for <100k vectors)
 * - Memory: ~4KB per vector (1024 dimensions × 4 bytes)
 *
 * For larger scale, consider upgrading to LanceDB or FAISS.
 *
 * @module storage/vector-store
 */

import { getDb, generateId } from './db.js';
import { angularDistance } from '../utils/angular-distance.js';
import type { VectorSearchResult } from './types.js';
import { createLogger } from '../utils/logger.js';
import { serializeEmbedding, deserializeEmbedding } from '../utils/embedding-utils.js';

const log = createLogger('vector-store');

/**
 * In-memory vector index backed by SQLite for persistence.
 *
 * Uses lazy loading — vectors are loaded from SQLite on first operation.
 * All operations are async to support future migration to async storage backends.
 *
 * Thread safety: Single-threaded (Node.js). For concurrent access, use
 * the singleton `vectorStore` export which ensures consistent state.
 */
// Export class for testing (allows creating fresh instances)
export class VectorStore {
  private vectors: Map<string, number[]> = new Map();
  private loaded = false;
  /** chunkId → projectSlug index for project-filtered search */
  private chunkProjectIndex: Map<string, string> = new Map();

  /**
   * Load vectors from database into memory.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const db = getDb();

    // Ensure vectors table exists with TTL columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        orphaned_at TEXT DEFAULT NULL,
        last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migrate existing tables
    const columns = db.prepare("PRAGMA table_info(vectors)").all() as { name: string }[];
    const hasOrphanedAt = columns.some((c) => c.name === 'orphaned_at');
    const hasLastAccessed = columns.some((c) => c.name === 'last_accessed');

    if (!hasOrphanedAt) {
      db.exec("ALTER TABLE vectors ADD COLUMN orphaned_at TEXT DEFAULT NULL");
    }
    if (!hasLastAccessed) {
      db.exec("ALTER TABLE vectors ADD COLUMN last_accessed TEXT DEFAULT CURRENT_TIMESTAMP");
      db.exec("UPDATE vectors SET last_accessed = CURRENT_TIMESTAMP WHERE last_accessed IS NULL");
    }

    const rows = db.prepare('SELECT id, embedding FROM vectors').all() as {
      id: string;
      embedding: Buffer;
    }[];

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding);
      this.vectors.set(row.id, embedding);
    }

    // Populate chunk→project index from chunks table
    try {
      const chunkRows = db.prepare(
        "SELECT id, session_slug FROM chunks WHERE session_slug != ''"
      ).all() as Array<{ id: string; session_slug: string }>;

      for (const row of chunkRows) {
        this.chunkProjectIndex.set(row.id, row.session_slug);
      }
    } catch {
      // chunks table may not exist yet (e.g., during migrations)
    }

    this.loaded = true;
  }

  /**
   * Insert a vector.
   */
  async insert(id: string, embedding: number[]): Promise<void> {
    await this.load();

    const db = getDb();
    const blob = serializeEmbedding(embedding);

    db.prepare(
      'INSERT OR REPLACE INTO vectors (id, embedding, orphaned_at, last_accessed) VALUES (?, ?, NULL, CURRENT_TIMESTAMP)'
    ).run(id, blob);

    this.vectors.set(id, embedding);

    // Update project index
    try {
      const row = db.prepare('SELECT session_slug FROM chunks WHERE id = ?').get(id) as { session_slug: string } | undefined;
      if (row?.session_slug) {
        this.chunkProjectIndex.set(id, row.session_slug);
      }
    } catch {
      // chunks table may not exist
    }
  }

  /**
   * Insert multiple vectors in a transaction.
   */
  async insertBatch(items: Array<{ id: string; embedding: number[] }>): Promise<void> {
    await this.load();

    const db = getDb();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO vectors (id, embedding, orphaned_at, last_accessed) VALUES (?, ?, NULL, CURRENT_TIMESTAMP)'
    );

    const insertMany = db.transaction((items: Array<{ id: string; embedding: number[] }>) => {
      for (const item of items) {
        const blob = serializeEmbedding(item.embedding);
        stmt.run(item.id, blob);
        this.vectors.set(item.id, item.embedding);
      }
    });

    insertMany(items);

    // Update project index for batch
    try {
      const ids = items.map(i => i.id);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(
          `SELECT id, session_slug FROM chunks WHERE id IN (${placeholders}) AND session_slug != ''`
        ).all(...ids) as Array<{ id: string; session_slug: string }>;
        for (const row of rows) {
          this.chunkProjectIndex.set(row.id, row.session_slug);
        }
      }
    } catch {
      // chunks table may not exist
    }
  }

  /**
   * Get a vector by ID.
   */
  async get(id: string): Promise<number[] | null> {
    await this.load();
    return this.vectors.get(id) ?? null;
  }

  /**
   * Search for similar vectors using angular distance.
   *
   * Uses brute-force search over all vectors in memory. For small to medium
   * datasets (<100k vectors), this is fast enough. For larger datasets,
   * consider approximate nearest neighbor (ANN) algorithms.
   *
   * Also updates `last_accessed` timestamp for returned vectors, keeping
   * them alive for TTL purposes.
   *
   * @param query - Query embedding vector (must match stored dimensionality)
   * @param limit - Maximum number of results to return
   * @returns Results sorted by distance ascending (closest first)
   *
   * @example
   * ```typescript
   * const results = await vectorStore.search(queryEmbedding, 10);
   * for (const { id, distance } of results) {
   *   console.log(`${id}: distance=${distance.toFixed(3)}`);
   * }
   * ```
   */
  async search(query: number[], limit: number): Promise<VectorSearchResult[]> {
    await this.load();

    const results: VectorSearchResult[] = [];

    for (const [id, embedding] of this.vectors) {
      const distance = angularDistance(query, embedding);
      results.push({ id, distance });
    }

    // Sort by distance and take top k
    results.sort((a, b) => a.distance - b.distance);
    const topResults = results.slice(0, limit);

    // Touch last_accessed for returned vectors (async, non-blocking)
    if (topResults.length > 0) {
      this.touchLastAccessed(topResults.map((r) => r.id));
    }

    return topResults;
  }

  /**
   * Search within a subset of IDs.
   * Also updates last_accessed for returned vectors.
   */
  async searchWithinIds(
    query: number[],
    candidateIds: string[],
    limit: number
  ): Promise<VectorSearchResult[]> {
    await this.load();

    const results: VectorSearchResult[] = [];
    const idSet = new Set(candidateIds);

    for (const [id, embedding] of this.vectors) {
      if (!idSet.has(id)) continue;
      const distance = angularDistance(query, embedding);
      results.push({ id, distance });
    }

    results.sort((a, b) => a.distance - b.distance);
    const topResults = results.slice(0, limit);

    // Touch last_accessed for returned vectors
    if (topResults.length > 0) {
      this.touchLastAccessed(topResults.map((r) => r.id));
    }

    return topResults;
  }

  /**
   * Search for similar vectors filtered to specific project(s).
   *
   * Skips vectors not belonging to the specified project(s) during
   * distance computation (more efficient than post-filtering).
   *
   * @param query - Query embedding vector
   * @param projects - Single project slug or array of project slugs
   * @param limit - Maximum results
   * @returns Results sorted by distance ascending
   */
  async searchByProject(
    query: number[],
    projects: string | string[],
    limit: number
  ): Promise<VectorSearchResult[]> {
    await this.load();

    const projectSet = new Set(Array.isArray(projects) ? projects : [projects]);
    const results: VectorSearchResult[] = [];

    for (const [id, embedding] of this.vectors) {
      const project = this.chunkProjectIndex.get(id);
      if (!project || !projectSet.has(project)) continue;

      const distance = angularDistance(query, embedding);
      results.push({ id, distance });
    }

    results.sort((a, b) => a.distance - b.distance);
    const topResults = results.slice(0, limit);

    if (topResults.length > 0) {
      this.touchLastAccessed(topResults.map((r) => r.id));
    }

    return topResults;
  }

  /**
   * Get the project slug for a chunk ID.
   */
  getChunkProject(id: string): string | undefined {
    return this.chunkProjectIndex.get(id);
  }

  /**
   * Delete a vector.
   */
  async delete(id: string): Promise<boolean> {
    await this.load();

    const db = getDb();
    const result = db.prepare('DELETE FROM vectors WHERE id = ?').run(id);

    this.vectors.delete(id);
    return result.changes > 0;
  }

  /**
   * Delete multiple vectors.
   */
  async deleteBatch(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    await this.load();

    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`DELETE FROM vectors WHERE id IN (${placeholders})`).run(...ids);

    for (const id of ids) {
      this.vectors.delete(id);
    }

    return result.changes;
  }

  /**
   * Get vector count.
   */
  async count(): Promise<number> {
    await this.load();
    return this.vectors.size;
  }

  /**
   * Check if a vector exists.
   */
  async has(id: string): Promise<boolean> {
    await this.load();
    return this.vectors.has(id);
  }

  /**
   * Clear all vectors (for testing).
   */
  async clear(): Promise<void> {
    const db = getDb();
    db.exec('DELETE FROM vectors');
    this.vectors.clear();
  }

  /**
   * Get all vector IDs.
   */
  async getAllIds(): Promise<string[]> {
    await this.load();
    return Array.from(this.vectors.keys());
  }

  /**
   * Get all vectors as an array (for clustering).
   */
  async getAllVectors(): Promise<Array<{ id: string; embedding: number[] }>> {
    await this.load();
    return Array.from(this.vectors.entries()).map(([id, embedding]) => ({
      id,
      embedding,
    }));
  }

  /**
   * Reset loaded state (for testing).
   */
  reset(): void {
    this.vectors.clear();
    this.chunkProjectIndex.clear();
    this.loaded = false;
  }

  // ─── TTL Management ─────────────────────────────────────────────────────────

  /**
   * Update last_accessed timestamp for vectors.
   * Called when vectors are returned from search to keep them alive.
   */
  private touchLastAccessed(ids: string[]): void {
    if (ids.length === 0) return;

    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE vectors SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  /**
   * Mark a vector as orphaned (its associated chunk was deleted).
   * The vector will be subject to TTL cleanup after this.
   * Called by pruner when deleting orphaned chunks.
   */
  async markOrphaned(id: string): Promise<void> {
    await this.load();

    const db = getDb();
    db.prepare(
      'UPDATE vectors SET orphaned_at = CURRENT_TIMESTAMP, last_accessed = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id);
  }

  /**
   * Mark multiple vectors as orphaned.
   */
  async markOrphanedBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.load();

    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE vectors SET orphaned_at = CURRENT_TIMESTAMP, last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  /**
   * Clean up expired orphaned vectors and their corresponding chunks.
   * Removes vectors that are orphaned AND haven't been accessed within the TTL period.
   * Also deletes the corresponding chunks (FK cascades handle cluster assignments and edges).
   *
   * @param ttlDays - Number of days after which orphaned vectors expire
   * @returns Number of vectors deleted
   */
  async cleanupExpired(ttlDays: number): Promise<number> {
    await this.load();

    const db = getDb();

    // Find expired orphaned vectors
    const expiredRows = db.prepare(`
      SELECT id FROM vectors
      WHERE orphaned_at IS NOT NULL
        AND last_accessed < datetime('now', '-' || ? || ' days')
    `).all(ttlDays) as { id: string }[];

    if (expiredRows.length === 0) {
      return 0;
    }

    const expiredIds = expiredRows.map((r) => r.id);
    const placeholders = expiredIds.map(() => '?').join(',');

    // Delete chunks first (FK cascades handle chunk_clusters and edges)
    db.prepare(
      `DELETE FROM chunks WHERE id IN (${placeholders})`
    ).run(...expiredIds);

    // Delete vectors
    const result = db.prepare(
      `DELETE FROM vectors WHERE id IN (${placeholders})`
    ).run(...expiredIds);

    // Remove empty clusters (no remaining members after chunk deletion)
    db.prepare(`
      DELETE FROM clusters WHERE id NOT IN (
        SELECT DISTINCT cluster_id FROM chunk_clusters
      )
    `).run();

    // Remove from memory
    for (const id of expiredIds) {
      this.vectors.delete(id);
    }

    return result.changes;
  }

  /**
   * Get count of orphaned vectors.
   */
  async getOrphanedCount(): Promise<number> {
    await this.load();

    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM vectors WHERE orphaned_at IS NOT NULL'
    ).get() as { count: number };

    return row.count;
  }
}

/**
 * Singleton vector store instance.
 *
 * Use this for all vector operations to ensure consistent state.
 * The instance lazy-loads vectors from SQLite on first operation.
 */
export const vectorStore = new VectorStore();

