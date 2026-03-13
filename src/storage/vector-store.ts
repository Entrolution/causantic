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

import { getDb, sqlPlaceholders } from './db.js';
import { angularDistance } from '../utils/angular-distance.js';
import type { VectorSearchResult } from './types.js';
import { serializeEmbedding, deserializeEmbedding } from '../utils/embedding-utils.js';
import { getModel } from '../models/model-registry.js';
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
  /** chunkId → agentId index for agent-filtered search */
  private chunkAgentIndex: Map<string, string> = new Map();
  /** chunkId → teamName index for team-filtered queries */
  private chunkTeamIndex: Map<string, string> = new Map();

  /** The model ID to filter vectors by. Set via setModelId(). */
  private modelId: string = 'jina-small';
  /** Expected embedding dimensions for the current model. */
  private expectedDims: number = 512;

  /** SQL table name for persistence. Default: 'vectors'. */
  private readonly tableName: string;
  /** Optional lookup table for resolving entity metadata (e.g. 'index_entries' for index vectors). */
  private readonly metadataTable: string | null;

  constructor(options?: { tableName?: string; metadataTable?: string | null }) {
    this.tableName = options?.tableName ?? 'vectors';
    this.metadataTable = options?.metadataTable ?? null;
  }

  /**
   * Set the active model ID for this vector store.
   * Only vectors matching this model_id are loaded and returned from search.
   */
  setModelId(modelId: string): void {
    const model = getModel(modelId); // throws if unknown
    this.modelId = modelId;
    this.expectedDims = model.dims;
    // Force reload to pick up model-filtered vectors
    if (this.loaded) {
      this.reset();
    }
  }

  /**
   * Get the active model ID.
   */
  getModelId(): string {
    return this.modelId;
  }

  /**
   * Load vectors from database into memory.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const db = getDb();

    // Ensure vectors table exists with TTL columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        orphaned_at TEXT DEFAULT NULL,
        last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
        model_id TEXT DEFAULT 'jina-small'
      )
    `);

    // Migrate existing tables
    const columns = db.prepare(`PRAGMA table_info(${this.tableName})`).all() as { name: string }[];
    const hasOrphanedAt = columns.some((c) => c.name === 'orphaned_at');
    const hasLastAccessed = columns.some((c) => c.name === 'last_accessed');
    const hasModelId = columns.some((c) => c.name === 'model_id');

    if (!hasOrphanedAt) {
      db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN orphaned_at TEXT DEFAULT NULL`);
    }
    if (!hasLastAccessed) {
      db.exec(
        `ALTER TABLE ${this.tableName} ADD COLUMN last_accessed TEXT DEFAULT CURRENT_TIMESTAMP`,
      );
      db.exec(
        `UPDATE ${this.tableName} SET last_accessed = CURRENT_TIMESTAMP WHERE last_accessed IS NULL`,
      );
    }
    if (!hasModelId) {
      db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN model_id TEXT DEFAULT 'jina-small'`);
      db.exec(`UPDATE ${this.tableName} SET model_id = 'jina-small' WHERE model_id IS NULL`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_model ON ${this.tableName}(model_id)`,
      );
    }

    // Load only vectors matching the active model_id
    const rows = db
      .prepare(`SELECT id, embedding FROM ${this.tableName} WHERE model_id = ?`)
      .all(this.modelId) as {
      id: string;
      embedding: Buffer;
    }[];

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding);
      this.vectors.set(row.id, embedding);
    }

    // Populate metadata indexes (project, agent, team)
    const metaTable = this.metadataTable ?? 'chunks';
    try {
      const projectRows = db
        .prepare(`SELECT id, session_slug FROM ${metaTable} WHERE session_slug != ''`)
        .all() as Array<{ id: string; session_slug: string }>;

      for (const row of projectRows) {
        this.chunkProjectIndex.set(row.id, row.session_slug);
      }
    } catch {
      // metadata table may not exist yet (e.g., during migrations)
    }

    try {
      const agentRows = db
        .prepare(`SELECT id, agent_id FROM ${metaTable} WHERE agent_id IS NOT NULL`)
        .all() as Array<{ id: string; agent_id: string }>;

      for (const row of agentRows) {
        this.chunkAgentIndex.set(row.id, row.agent_id);
      }
    } catch {
      // metadata table may not exist yet
    }

    try {
      const teamRows = db
        .prepare(`SELECT id, team_name FROM ${metaTable} WHERE team_name IS NOT NULL`)
        .all() as Array<{ id: string; team_name: string }>;

      for (const row of teamRows) {
        this.chunkTeamIndex.set(row.id, row.team_name);
      }
    } catch {
      // metadata table may not exist yet
    }

    this.loaded = true;
  }

  /**
   * Insert a vector.
   * @throws Error if embedding dimensions don't match the current model's expected dimensions.
   */
  async insert(id: string, embedding: number[]): Promise<void> {
    await this.load();

    if (embedding.length !== this.expectedDims) {
      throw new Error(
        `Dimension mismatch: embedding has ${embedding.length} dims, but model '${this.modelId}' expects ${this.expectedDims}`,
      );
    }

    const db = getDb();
    const blob = serializeEmbedding(embedding);

    db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, embedding, orphaned_at, last_accessed, model_id) VALUES (?, ?, NULL, CURRENT_TIMESTAMP, ?)`,
    ).run(id, blob, this.modelId);

    this.vectors.set(id, embedding);

    // Update project, agent, and team indexes
    const metaTable = this.metadataTable ?? 'chunks';
    try {
      const row = db
        .prepare(`SELECT session_slug, agent_id, team_name FROM ${metaTable} WHERE id = ?`)
        .get(id) as
        | { session_slug: string; agent_id: string | null; team_name: string | null }
        | undefined;
      if (row?.session_slug) {
        this.chunkProjectIndex.set(id, row.session_slug);
      }
      if (row?.agent_id) {
        this.chunkAgentIndex.set(id, row.agent_id);
      }
      if (row?.team_name) {
        this.chunkTeamIndex.set(id, row.team_name);
      }
    } catch {
      // metadata table may not exist
    }
  }

  /**
   * Insert multiple vectors in a transaction.
   * @throws Error if any embedding dimensions don't match the current model's expected dimensions.
   */
  async insertBatch(items: Array<{ id: string; embedding: number[] }>): Promise<void> {
    await this.load();

    // Dimension guard: check all items before inserting any
    for (const item of items) {
      if (item.embedding.length !== this.expectedDims) {
        throw new Error(
          `Dimension mismatch: embedding for '${item.id}' has ${item.embedding.length} dims, but model '${this.modelId}' expects ${this.expectedDims}`,
        );
      }
    }

    const db = getDb();
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, embedding, orphaned_at, last_accessed, model_id) VALUES (?, ?, NULL, CURRENT_TIMESTAMP, ?)`,
    );

    const modelId = this.modelId;
    const insertMany = db.transaction((items: Array<{ id: string; embedding: number[] }>) => {
      for (const item of items) {
        const blob = serializeEmbedding(item.embedding);
        stmt.run(item.id, blob, modelId);
        this.vectors.set(item.id, item.embedding);
      }
    });

    insertMany(items);

    // Update project, agent, and team indexes for batch
    const metaTable = this.metadataTable ?? 'chunks';
    try {
      const ids = items.map((i) => i.id);
      if (ids.length > 0) {
        const placeholders = sqlPlaceholders(ids.length);
        const rows = db
          .prepare(
            `SELECT id, session_slug, agent_id, team_name FROM ${metaTable} WHERE id IN (${placeholders}) AND session_slug != ''`,
          )
          .all(...ids) as Array<{
          id: string;
          session_slug: string;
          agent_id: string | null;
          team_name: string | null;
        }>;
        for (const row of rows) {
          this.chunkProjectIndex.set(row.id, row.session_slug);
          if (row.agent_id) {
            this.chunkAgentIndex.set(row.id, row.agent_id);
          }
          if (row.team_name) {
            this.chunkTeamIndex.set(row.id, row.team_name);
          }
        }
      }
    } catch {
      // metadata table may not exist
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

    return this.rankAndTouch(results, limit);
  }

  /**
   * Search within a subset of IDs.
   * Also updates last_accessed for returned vectors.
   */
  async searchWithinIds(
    query: number[],
    candidateIds: string[],
    limit: number,
  ): Promise<VectorSearchResult[]> {
    await this.load();

    const results: VectorSearchResult[] = [];
    const idSet = new Set(candidateIds);

    for (const [id, embedding] of this.vectors) {
      if (!idSet.has(id)) continue;
      const distance = angularDistance(query, embedding);
      results.push({ id, distance });
    }

    return this.rankAndTouch(results, limit);
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
    limit: number,
    agentId?: string,
  ): Promise<VectorSearchResult[]> {
    await this.load();

    const projectSet = new Set(Array.isArray(projects) ? projects : [projects]);
    const results: VectorSearchResult[] = [];

    for (const [id, embedding] of this.vectors) {
      const project = this.chunkProjectIndex.get(id);
      if (!project || !projectSet.has(project)) continue;

      if (agentId) {
        const chunkAgent = this.chunkAgentIndex.get(id);
        if (chunkAgent !== agentId) continue;
      }

      const distance = angularDistance(query, embedding);
      results.push({ id, distance });
    }

    return this.rankAndTouch(results, limit);
  }

  /**
   * Get the project slug for a chunk ID.
   */
  getChunkProject(id: string): string | undefined {
    return this.chunkProjectIndex.get(id);
  }

  /**
   * Get the agent ID for a chunk ID.
   */
  getChunkAgent(id: string): string | undefined {
    return this.chunkAgentIndex.get(id);
  }

  /**
   * Get the team name for a chunk ID.
   */
  getChunkTeam(id: string): string | undefined {
    return this.chunkTeamIndex.get(id);
  }

  /**
   * Delete a vector.
   */
  async delete(id: string): Promise<boolean> {
    await this.load();

    const db = getDb();
    const result = db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);

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
    const placeholders = sqlPlaceholders(ids.length);
    const result = db
      .prepare(`DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`)
      .run(...ids);

    for (const id of ids) {
      this.vectors.delete(id);
      this.chunkProjectIndex.delete(id);
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
    db.exec(`DELETE FROM ${this.tableName}`);
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
    this.chunkAgentIndex.clear();
    this.chunkTeamIndex.clear();
    this.loaded = false;
  }

  // ─── TTL Management ─────────────────────────────────────────────────────────

  /**
   * Update last_accessed timestamp for vectors.
   * Called when vectors are returned from search to keep them alive.
   */
  /**
   * Sort results by distance, take top-k, and touch last_accessed timestamps.
   * Shared post-processing for all search methods.
   */
  private rankAndTouch(results: VectorSearchResult[], limit: number): VectorSearchResult[] {
    results.sort((a, b) => a.distance - b.distance);
    const topResults = results.slice(0, limit);

    if (topResults.length > 0) {
      this.touchLastAccessed(topResults.map((r) => r.id));
    }

    return topResults;
  }

  private touchLastAccessed(ids: string[]): void {
    if (ids.length === 0) return;

    const db = getDb();
    const placeholders = sqlPlaceholders(ids.length);
    db.prepare(
      `UPDATE ${this.tableName} SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
    ).run(...ids);
  }

  /**
   * Clean up expired vectors and their corresponding chunks.
   * Removes vectors that haven't been accessed within the TTL period.
   * Also deletes the corresponding chunks (FK cascades handle cluster assignments and edges).
   *
   * @param ttlDays - Number of days after which unaccessed vectors expire
   * @returns Number of vectors deleted
   */
  async cleanupExpired(ttlDays: number): Promise<number> {
    await this.load();

    const db = getDb();

    // Find expired vectors (any vector not accessed within TTL)
    const expiredRows = db
      .prepare(
        `
      SELECT id FROM ${this.tableName}
      WHERE last_accessed < datetime('now', '-' || ? || ' days')
    `,
      )
      .all(ttlDays) as { id: string }[];

    if (expiredRows.length === 0) {
      return 0;
    }

    const expiredIds = expiredRows.map((r) => r.id);
    const placeholders = sqlPlaceholders(expiredIds.length);

    // Delete chunks first (FK cascades handle chunk_clusters and edges)
    db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...expiredIds);

    // Delete vectors
    const result = db
      .prepare(`DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`)
      .run(...expiredIds);

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
      const placeholdersForCleanup = sqlPlaceholders(expiredIds.length);
      // Remove reverse-lookup rows
      db.prepare(
        `DELETE FROM index_entry_chunks WHERE chunk_id IN (${placeholdersForCleanup})`,
      ).run(...expiredIds);

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
        db.prepare(`DELETE FROM index_entries WHERE id IN (${orphanPlaceholders})`).run(
          ...orphanIds,
        );

        // Remove from index vector store (if this is the chunk vector store)
        if (this.tableName === 'vectors') {
          db.prepare(`DELETE FROM index_vectors WHERE id IN (${orphanPlaceholders})`).run(
            ...orphanIds,
          );
        }
      }
    } catch {
      // index_entry_chunks table may not exist yet
    }

    // Remove from memory
    for (const id of expiredIds) {
      this.vectors.delete(id);
      this.chunkProjectIndex.delete(id);
    }

    return result.changes;
  }

  /**
   * Evict the oldest vectors when collection exceeds maxCount.
   * Deletes vectors (and their chunks via FK cascade) by ascending last_accessed.
   *
   * @param maxCount - Maximum number of vectors to retain (0 = unlimited)
   * @returns Number of vectors evicted
   */
  async evictOldest(maxCount: number): Promise<number> {
    if (maxCount <= 0) return 0;

    await this.load();

    const currentCount = this.vectors.size;
    if (currentCount <= maxCount) return 0;

    const overage = currentCount - maxCount;
    const db = getDb();

    // Select the oldest vectors by last_accessed
    const toEvict = db
      .prepare(
        `
      SELECT id FROM ${this.tableName}
      ORDER BY last_accessed ASC
      LIMIT ?
    `,
      )
      .all(overage) as { id: string }[];

    if (toEvict.length === 0) return 0;

    const evictIds = toEvict.map((r) => r.id);
    const placeholders = sqlPlaceholders(evictIds.length);

    // Delete chunks first (FK cascades handle chunk_clusters and edges)
    db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...evictIds);

    // Delete vectors
    const result = db
      .prepare(`DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`)
      .run(...evictIds);

    // Remove empty clusters
    db.prepare(
      `
      DELETE FROM clusters WHERE id NOT IN (
        SELECT DISTINCT cluster_id FROM chunk_clusters
      )
    `,
    ).run();

    // Clean up index entries that referenced the deleted chunks
    try {
      const placeholdersForCleanup = sqlPlaceholders(evictIds.length);
      db.prepare(
        `DELETE FROM index_entry_chunks WHERE chunk_id IN (${placeholdersForCleanup})`,
      ).run(...evictIds);

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
        db.prepare(`DELETE FROM index_entries WHERE id IN (${orphanPlaceholders})`).run(
          ...orphanIds,
        );

        if (this.tableName === 'vectors') {
          db.prepare(`DELETE FROM index_vectors WHERE id IN (${orphanPlaceholders})`).run(
            ...orphanIds,
          );
        }
      }
    } catch {
      // index_entry_chunks table may not exist yet
    }

    // Remove from memory
    for (const id of evictIds) {
      this.vectors.delete(id);
      this.chunkProjectIndex.delete(id);
    }

    return result.changes;
  }
}

/**
 * Singleton vector store instance for chunk embeddings.
 *
 * Use this for all chunk vector operations to ensure consistent state.
 * The instance lazy-loads vectors from SQLite on first operation.
 */
export const vectorStore = new VectorStore();

/**
 * Singleton vector store instance for index entry embeddings.
 *
 * Stores embeddings in the `index_vectors` table and looks up metadata
 * from the `index_entries` table for project/agent/team filtering.
 */
export const indexVectorStore = new VectorStore({
  tableName: 'index_vectors',
  metadataTable: 'index_entries',
});
