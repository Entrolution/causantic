/**
 * Tests for retrieval feedback store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';
import {
  recordRetrieval,
  getFeedbackScores,
  getPopularChunks,
  _queryHash,
} from '../../src/storage/feedback-store.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (13);

    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      session_slug TEXT NOT NULL,
      turn_indices TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE retrieval_feedback (
      chunk_id TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      returned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      tool_name TEXT NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_retrieval_feedback_chunk ON retrieval_feedback(chunk_id);
  `);
  return db;
}

function insertChunk(db: Database.Database, id: string): void {
  db.prepare(
    "INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content) VALUES (?, 'sess', 'proj', '[0]', '2024-01-01', '2024-01-01', 'content')",
  ).run(id);
}

describe('feedback-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    insertChunk(db, 'c1');
    insertChunk(db, 'c2');
    insertChunk(db, 'c3');
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  describe('queryHash', () => {
    it('returns 8-character hex string', () => {
      const hash = _queryHash('test query');
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('is deterministic', () => {
      expect(_queryHash('hello')).toBe(_queryHash('hello'));
    });

    it('differs for different inputs', () => {
      expect(_queryHash('hello')).not.toBe(_queryHash('world'));
    });
  });

  describe('recordRetrieval', () => {
    it('inserts one row per chunk', () => {
      recordRetrieval(['c1', 'c2'], 'test query', 'search');

      const count = db.prepare('SELECT COUNT(*) as cnt FROM retrieval_feedback').get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(2);
    });

    it('stores tool name and query hash', () => {
      recordRetrieval(['c1'], 'my query', 'recall');

      const row = db.prepare('SELECT * FROM retrieval_feedback WHERE chunk_id = ?').get('c1') as {
        chunk_id: string;
        query_hash: string;
        tool_name: string;
      };
      expect(row.tool_name).toBe('recall');
      expect(row.query_hash).toBe(_queryHash('my query'));
    });

    it('no-ops for empty chunk list', () => {
      recordRetrieval([], 'test', 'search');

      const count = db.prepare('SELECT COUNT(*) as cnt FROM retrieval_feedback').get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(0);
    });

    it('allows multiple records for same chunk (accumulates)', () => {
      recordRetrieval(['c1'], 'query1', 'search');
      recordRetrieval(['c1'], 'query2', 'recall');
      recordRetrieval(['c1'], 'query1', 'search');

      const count = db
        .prepare("SELECT COUNT(*) as cnt FROM retrieval_feedback WHERE chunk_id = 'c1'")
        .get() as { cnt: number };
      expect(count.cnt).toBe(3);
    });
  });

  describe('getFeedbackScores', () => {
    it('returns empty map for no chunks', () => {
      const scores = getFeedbackScores([]);
      expect(scores.size).toBe(0);
    });

    it('returns empty map when no feedback exists', () => {
      const scores = getFeedbackScores(['c1', 'c2']);
      expect(scores.size).toBe(0);
    });

    it('returns log2(1 + count) scores', () => {
      // c1: 1 retrieval → log2(2) = 1.0
      recordRetrieval(['c1'], 'q1', 'search');

      // c2: 3 retrievals → log2(4) ≈ 2.0
      recordRetrieval(['c2'], 'q1', 'search');
      recordRetrieval(['c2'], 'q2', 'recall');
      recordRetrieval(['c2'], 'q3', 'predict');

      const scores = getFeedbackScores(['c1', 'c2', 'c3']);

      expect(scores.get('c1')).toBeCloseTo(1.0, 5);
      expect(scores.get('c2')).toBeCloseTo(2.0, 5);
      expect(scores.has('c3')).toBe(false); // no feedback
    });

    it('only returns scores for requested chunks', () => {
      recordRetrieval(['c1', 'c2'], 'q1', 'search');

      const scores = getFeedbackScores(['c1']);
      expect(scores.has('c1')).toBe(true);
      expect(scores.has('c2')).toBe(false);
    });
  });

  describe('getPopularChunks', () => {
    it('returns empty array when no feedback', () => {
      const popular = getPopularChunks();
      expect(popular).toEqual([]);
    });

    it('returns chunks sorted by count descending', () => {
      recordRetrieval(['c1'], 'q1', 'search');
      recordRetrieval(['c2'], 'q1', 'search');
      recordRetrieval(['c2'], 'q2', 'search');
      recordRetrieval(['c3'], 'q1', 'search');
      recordRetrieval(['c3'], 'q2', 'search');
      recordRetrieval(['c3'], 'q3', 'search');

      const popular = getPopularChunks(3);
      expect(popular).toEqual([
        { chunkId: 'c3', count: 3 },
        { chunkId: 'c2', count: 2 },
        { chunkId: 'c1', count: 1 },
      ]);
    });

    it('respects limit parameter', () => {
      recordRetrieval(['c1', 'c2', 'c3'], 'q1', 'search');

      const popular = getPopularChunks(2);
      expect(popular.length).toBe(2);
    });
  });
});
