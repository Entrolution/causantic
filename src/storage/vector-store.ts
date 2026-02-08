/**
 * In-memory vector store with optional persistence.
 * Start simple with in-memory + SQLite persistence.
 * Can upgrade to LanceDB if performance requires.
 */

import { getDb, generateId } from './db.js';
import { angularDistance } from '../utils/angular-distance.js';
import type { VectorSearchResult } from './types.js';

/**
 * In-memory vector index backed by SQLite for persistence.
 */
class VectorStore {
  private vectors: Map<string, number[]> = new Map();
  private loaded = false;

  /**
   * Load vectors from database into memory.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const db = getDb();

    // Ensure vectors table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL
      )
    `);

    const rows = db.prepare('SELECT id, embedding FROM vectors').all() as {
      id: string;
      embedding: Buffer;
    }[];

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding);
      this.vectors.set(row.id, embedding);
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

    db.prepare('INSERT OR REPLACE INTO vectors (id, embedding) VALUES (?, ?)').run(id, blob);

    this.vectors.set(id, embedding);
  }

  /**
   * Insert multiple vectors in a transaction.
   */
  async insertBatch(items: Array<{ id: string; embedding: number[] }>): Promise<void> {
    await this.load();

    const db = getDb();
    const stmt = db.prepare('INSERT OR REPLACE INTO vectors (id, embedding) VALUES (?, ?)');

    const insertMany = db.transaction((items: Array<{ id: string; embedding: number[] }>) => {
      for (const item of items) {
        const blob = serializeEmbedding(item.embedding);
        stmt.run(item.id, blob);
        this.vectors.set(item.id, item.embedding);
      }
    });

    insertMany(items);
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
   * Returns results sorted by distance (ascending).
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
    return results.slice(0, limit);
  }

  /**
   * Search within a subset of IDs.
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
    return results.slice(0, limit);
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
    this.loaded = false;
  }
}

// Singleton instance
export const vectorStore = new VectorStore();

// Helper functions

function serializeEmbedding(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

function deserializeEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(float32);
}
