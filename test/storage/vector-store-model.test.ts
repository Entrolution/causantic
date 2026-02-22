/**
 * Tests for VectorStore multi-model support (Item 14).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { VectorStore } from '../../src/storage/vector-store.js';
import { setDb, resetDb } from '../../src/storage/db.js';
import { serializeEmbedding } from '../../src/utils/embedding-utils.js';

describe('VectorStore multi-model support', () => {
  let db: Database.Database;
  let store: VectorStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create minimal schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_slug TEXT NOT NULL,
        turn_indices TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        content TEXT NOT NULL,
        approx_tokens INTEGER DEFAULT 0,
        agent_id TEXT,
        team_name TEXT
      );
    `);

    setDb(db);
    store = new VectorStore();
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  describe('dimension guard', () => {
    it('throws on insert when embedding dimensions mismatch', async () => {
      // jina-small expects 512 dims
      const wrongDims = new Array(768).fill(0.1);

      await expect(store.insert('chunk-1', wrongDims)).rejects.toThrow(
        /Dimension mismatch.*768.*512/,
      );
    });

    it('accepts insert when embedding dimensions match', async () => {
      const correctDims = new Array(512).fill(0.1);

      await expect(store.insert('chunk-1', correctDims)).resolves.not.toThrow();
    });

    it('throws on insertBatch when any embedding has wrong dimensions', async () => {
      const correct = new Array(512).fill(0.1);
      const wrong = new Array(384).fill(0.1);

      await expect(
        store.insertBatch([
          { id: 'chunk-1', embedding: correct },
          { id: 'chunk-2', embedding: wrong },
        ]),
      ).rejects.toThrow(/Dimension mismatch.*chunk-2.*384.*512/);

      // Verify nothing was inserted (all-or-nothing)
      expect(await store.count()).toBe(0);
    });

    it('updates expected dimensions when model changes', async () => {
      store.setModelId('nomic-v1.5'); // 768 dims
      const embedding768 = new Array(768).fill(0.1);
      const embedding512 = new Array(512).fill(0.1);

      // 768 should now be accepted
      await expect(store.insert('chunk-1', embedding768)).resolves.not.toThrow();

      // 512 should now be rejected
      await expect(store.insert('chunk-2', embedding512)).rejects.toThrow(/Dimension mismatch/);
    });
  });

  describe('model_id column', () => {
    it('stores model_id with inserted vectors', async () => {
      const embedding = new Array(512).fill(0.1);
      await store.insert('chunk-1', embedding);

      const row = db.prepare('SELECT model_id FROM vectors WHERE id = ?').get('chunk-1') as {
        model_id: string;
      };
      expect(row.model_id).toBe('jina-small');
    });

    it('stores correct model_id when model is changed', async () => {
      store.setModelId('nomic-v1.5');
      const embedding = new Array(768).fill(0.1);
      await store.insert('chunk-1', embedding);

      const row = db.prepare('SELECT model_id FROM vectors WHERE id = ?').get('chunk-1') as {
        model_id: string;
      };
      expect(row.model_id).toBe('nomic-v1.5');
    });

    it('insertBatch stores model_id for all items', async () => {
      const embedding = new Array(512).fill(0.1);
      await store.insertBatch([
        { id: 'chunk-1', embedding },
        { id: 'chunk-2', embedding },
      ]);

      const rows = db.prepare('SELECT model_id FROM vectors').all() as Array<{
        model_id: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.model_id === 'jina-small')).toBe(true);
    });
  });

  describe('model-filtered loading', () => {
    it('only loads vectors matching active model_id', async () => {
      // Manually insert vectors with different model_ids
      const emb512 = serializeEmbedding(new Array(512).fill(0.1));
      const emb768 = serializeEmbedding(new Array(768).fill(0.2));

      db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          orphaned_at TEXT DEFAULT NULL,
          last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
          model_id TEXT DEFAULT 'jina-small'
        )
      `);

      db.prepare(
        "INSERT INTO vectors (id, embedding, model_id) VALUES ('c1', ?, 'jina-small')",
      ).run(emb512);
      db.prepare(
        "INSERT INTO vectors (id, embedding, model_id) VALUES ('c2', ?, 'nomic-v1.5')",
      ).run(emb768);
      db.prepare(
        "INSERT INTO vectors (id, embedding, model_id) VALUES ('c3', ?, 'jina-small')",
      ).run(emb512);

      // Default model is jina-small — should only see c1 and c3
      const freshStore = new VectorStore();
      await freshStore.load();
      expect(await freshStore.count()).toBe(2);
      expect(await freshStore.has('c1')).toBe(true);
      expect(await freshStore.has('c2')).toBe(false);
      expect(await freshStore.has('c3')).toBe(true);
    });

    it('search only returns vectors for active model', async () => {
      const emb512 = serializeEmbedding(new Array(512).fill(0.1));
      const emb768 = serializeEmbedding(new Array(768).fill(0.2));

      db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          orphaned_at TEXT DEFAULT NULL,
          last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
          model_id TEXT DEFAULT 'jina-small'
        )
      `);

      db.prepare(
        "INSERT INTO vectors (id, embedding, model_id) VALUES ('c1', ?, 'jina-small')",
      ).run(emb512);
      db.prepare(
        "INSERT INTO vectors (id, embedding, model_id) VALUES ('c2', ?, 'nomic-v1.5')",
      ).run(emb768);

      const freshStore = new VectorStore();
      const query = new Array(512).fill(0.1);
      const results = await freshStore.search(query, 10);

      // Should only find c1 (jina-small), not c2 (nomic-v1.5)
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('c1');
    });
  });

  describe('setModelId', () => {
    it('throws on unknown model ID', () => {
      expect(() => store.setModelId('nonexistent-model')).toThrow(/Unknown model/);
    });

    it('resets loaded state when model changes', async () => {
      const embedding = new Array(512).fill(0.1);
      await store.insert('chunk-1', embedding);
      expect(await store.count()).toBe(1);

      // Changing model should reset
      store.setModelId('nomic-v1.5');
      // After reset, it will reload from DB — no nomic vectors exist, so 0
      expect(await store.count()).toBe(0);
    });

    it('getModelId returns current model', () => {
      expect(store.getModelId()).toBe('jina-small');
      store.setModelId('bge-small');
      expect(store.getModelId()).toBe('bge-small');
    });
  });
});
