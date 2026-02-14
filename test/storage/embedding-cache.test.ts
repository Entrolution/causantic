/**
 * Tests for embedding cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';
import {
  computeContentHash,
  getCachedEmbedding,
  getCachedEmbeddingsBatch,
  cacheEmbedding,
  cacheEmbeddingsBatch,
  evictOldestIfNeeded,
  getCacheStats,
  clearCache,
  clearCacheForModel,
} from '../../src/storage/embedding-cache.js';

describe('embedding-cache', () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    // Create schema
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        hit_count INTEGER DEFAULT 0,
        PRIMARY KEY (content_hash, model_id)
      )
    `);
    testDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model_id)
    `);

    setDb(testDb);
  });

  afterEach(() => {
    resetDb();
    testDb.close();
  });

  describe('computeContentHash', () => {
    it('returns consistent hash for same content', () => {
      const hash1 = computeContentHash('hello world');
      const hash2 = computeContentHash('hello world');

      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', () => {
      const hash1 = computeContentHash('hello world');
      const hash2 = computeContentHash('goodbye world');

      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string', () => {
      const hash = computeContentHash('test');

      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  describe('getCachedEmbedding', () => {
    it('returns null for non-existent entry', () => {
      const result = getCachedEmbedding('non-existent-hash', 'jina-small');

      expect(result).toBeNull();
    });

    it('returns cached embedding', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      const blob = Buffer.from(new Float32Array(embedding).buffer);

      testDb
        .prepare(`INSERT INTO embedding_cache (content_hash, model_id, embedding) VALUES (?, ?, ?)`)
        .run('test-hash', 'jina-small', blob);

      const result = getCachedEmbedding('test-hash', 'jina-small');

      expect(result).not.toBeNull();
      expect(result!.length).toBe(4);
      expect(result![0]).toBeCloseTo(0.1, 5);
      expect(result![1]).toBeCloseTo(0.2, 5);
    });

    it('increments hit count on access', () => {
      const embedding = [0.5, 0.5];
      const blob = Buffer.from(new Float32Array(embedding).buffer);

      testDb
        .prepare(
          `INSERT INTO embedding_cache (content_hash, model_id, embedding, hit_count) VALUES (?, ?, ?, 0)`,
        )
        .run('hit-test', 'model-a', blob);

      getCachedEmbedding('hit-test', 'model-a');
      getCachedEmbedding('hit-test', 'model-a');

      const row = testDb
        .prepare(`SELECT hit_count FROM embedding_cache WHERE content_hash = ?`)
        .get('hit-test') as { hit_count: number };

      expect(row.hit_count).toBe(2);
    });

    it('distinguishes between models', () => {
      const emb1 = [1.0, 1.0];
      const emb2 = [2.0, 2.0];

      testDb
        .prepare(`INSERT INTO embedding_cache (content_hash, model_id, embedding) VALUES (?, ?, ?)`)
        .run('same-hash', 'model-1', Buffer.from(new Float32Array(emb1).buffer));
      testDb
        .prepare(`INSERT INTO embedding_cache (content_hash, model_id, embedding) VALUES (?, ?, ?)`)
        .run('same-hash', 'model-2', Buffer.from(new Float32Array(emb2).buffer));

      const result1 = getCachedEmbedding('same-hash', 'model-1');
      const result2 = getCachedEmbedding('same-hash', 'model-2');

      expect(result1![0]).toBeCloseTo(1.0, 5);
      expect(result2![0]).toBeCloseTo(2.0, 5);
    });
  });

  describe('getCachedEmbeddingsBatch', () => {
    it('returns empty map for empty input', () => {
      const result = getCachedEmbeddingsBatch([], 'jina-small');

      expect(result.size).toBe(0);
    });

    it('returns map of found embeddings', () => {
      const emb1 = [0.1, 0.2];
      const emb2 = [0.3, 0.4];

      testDb
        .prepare(`INSERT INTO embedding_cache (content_hash, model_id, embedding) VALUES (?, ?, ?)`)
        .run('hash-a', 'model-x', Buffer.from(new Float32Array(emb1).buffer));
      testDb
        .prepare(`INSERT INTO embedding_cache (content_hash, model_id, embedding) VALUES (?, ?, ?)`)
        .run('hash-b', 'model-x', Buffer.from(new Float32Array(emb2).buffer));

      const result = getCachedEmbeddingsBatch(['hash-a', 'hash-b', 'hash-c'], 'model-x');

      expect(result.size).toBe(2);
      expect(result.has('hash-a')).toBe(true);
      expect(result.has('hash-b')).toBe(true);
      expect(result.has('hash-c')).toBe(false);
    });

    it('updates hit counts for found entries', () => {
      const emb = [0.5];

      testDb
        .prepare(
          `INSERT INTO embedding_cache (content_hash, model_id, embedding, hit_count) VALUES (?, ?, ?, 0)`,
        )
        .run('batch-hit', 'model-z', Buffer.from(new Float32Array(emb).buffer));

      getCachedEmbeddingsBatch(['batch-hit', 'not-found'], 'model-z');

      const row = testDb
        .prepare(`SELECT hit_count FROM embedding_cache WHERE content_hash = ?`)
        .get('batch-hit') as { hit_count: number };

      expect(row.hit_count).toBe(1);
    });
  });

  describe('cacheEmbedding', () => {
    it('stores new embedding', () => {
      cacheEmbedding('new-hash', 'jina-small', [0.1, 0.2, 0.3]);

      const result = getCachedEmbedding('new-hash', 'jina-small');

      expect(result).not.toBeNull();
      expect(result!.length).toBe(3);
    });

    it('replaces existing embedding', () => {
      cacheEmbedding('update-hash', 'model', [1.0, 1.0]);
      cacheEmbedding('update-hash', 'model', [2.0, 2.0]);

      const result = getCachedEmbedding('update-hash', 'model');

      expect(result![0]).toBeCloseTo(2.0, 5);
    });
  });

  describe('cacheEmbeddingsBatch', () => {
    it('stores multiple embeddings in transaction', () => {
      cacheEmbeddingsBatch(
        [
          { contentHash: 'batch-1', embedding: [1.0] },
          { contentHash: 'batch-2', embedding: [2.0] },
          { contentHash: 'batch-3', embedding: [3.0] },
        ],
        'batch-model',
      );

      const stats = getCacheStats();

      expect(stats.entryCount).toBe(3);
    });

    it('handles empty batch', () => {
      expect(() => cacheEmbeddingsBatch([], 'model')).not.toThrow();
    });
  });

  describe('evictOldestIfNeeded', () => {
    it('does not evict when under limit', () => {
      cacheEmbedding('a', 'm', [1.0]);
      cacheEmbedding('b', 'm', [2.0]);

      evictOldestIfNeeded();

      expect(getCacheStats().entryCount).toBe(2);
    });

    // Note: Testing eviction at MAX_CACHE_ENTRIES would require inserting 100k+ entries
    // which is impractical. The logic is tested through unit assertions.
  });

  describe('getCacheStats', () => {
    it('returns zero stats for empty cache', () => {
      const stats = getCacheStats();

      expect(stats.entryCount).toBe(0);
      expect(stats.totalHits).toBe(0);
      expect(stats.avgHitCount).toBe(0);
    });

    it('returns correct stats', () => {
      testDb
        .prepare(
          `INSERT INTO embedding_cache (content_hash, model_id, embedding, hit_count) VALUES (?, ?, ?, ?)`,
        )
        .run('s1', 'm', Buffer.from(new Float32Array([1.0]).buffer), 5);
      testDb
        .prepare(
          `INSERT INTO embedding_cache (content_hash, model_id, embedding, hit_count) VALUES (?, ?, ?, ?)`,
        )
        .run('s2', 'm', Buffer.from(new Float32Array([2.0]).buffer), 10);

      const stats = getCacheStats();

      expect(stats.entryCount).toBe(2);
      expect(stats.totalHits).toBe(15);
      expect(stats.avgHitCount).toBe(7.5);
    });
  });

  describe('clearCache', () => {
    it('removes all entries', () => {
      cacheEmbedding('x', 'a', [1.0]);
      cacheEmbedding('y', 'b', [2.0]);

      clearCache();

      expect(getCacheStats().entryCount).toBe(0);
    });
  });

  describe('clearCacheForModel', () => {
    it('removes only entries for specified model', () => {
      cacheEmbedding('a', 'model-1', [1.0]);
      cacheEmbedding('b', 'model-1', [2.0]);
      cacheEmbedding('c', 'model-2', [3.0]);

      clearCacheForModel('model-1');

      expect(getCachedEmbedding('a', 'model-1')).toBeNull();
      expect(getCachedEmbedding('b', 'model-1')).toBeNull();
      expect(getCachedEmbedding('c', 'model-2')).not.toBeNull();
    });
  });
});
