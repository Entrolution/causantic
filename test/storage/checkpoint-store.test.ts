/**
 * Tests for checkpoint store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';
import {
  getCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  deleteProjectCheckpoints,
  getProjectCheckpoints,
  type IngestionCheckpoint,
} from '../../src/storage/checkpoint-store.js';

describe('checkpoint-store', () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    // Create schema
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
        session_id TEXT PRIMARY KEY,
        project_slug TEXT NOT NULL,
        last_turn_index INTEGER NOT NULL,
        last_chunk_id TEXT,
        vector_clock TEXT,
        file_mtime TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    testDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_project ON ingestion_checkpoints(project_slug)
    `);

    setDb(testDb);
  });

  afterEach(() => {
    resetDb();
    testDb.close();
  });

  describe('getCheckpoint', () => {
    it('returns null for non-existent session', () => {
      const result = getCheckpoint('non-existent-session');
      expect(result).toBeNull();
    });

    it('returns checkpoint for existing session', () => {
      testDb
        .prepare(
          `INSERT INTO ingestion_checkpoints
           (session_id, project_slug, last_turn_index, last_chunk_id, vector_clock, file_mtime)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('session-1', 'my-project', 10, 'chunk-abc', '{"main":5}', '2024-01-01T00:00:00.000Z');

      const result = getCheckpoint('session-1');

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('session-1');
      expect(result!.projectSlug).toBe('my-project');
      expect(result!.lastTurnIndex).toBe(10);
      expect(result!.lastChunkId).toBe('chunk-abc');
      expect(result!.vectorClock).toBe('{"main":5}');
      expect(result!.fileMtime).toBe('2024-01-01T00:00:00.000Z');
    });

    it('handles null optional fields', () => {
      testDb
        .prepare(
          `INSERT INTO ingestion_checkpoints
           (session_id, project_slug, last_turn_index)
           VALUES (?, ?, ?)`
        )
        .run('session-2', 'my-project', 5);

      const result = getCheckpoint('session-2');

      expect(result).not.toBeNull();
      expect(result!.lastChunkId).toBeNull();
      expect(result!.vectorClock).toBeNull();
      expect(result!.fileMtime).toBeNull();
    });
  });

  describe('saveCheckpoint', () => {
    it('inserts new checkpoint', () => {
      saveCheckpoint({
        sessionId: 'new-session',
        projectSlug: 'test-project',
        lastTurnIndex: 3,
        lastChunkId: 'chunk-123',
        vectorClock: '{"main":2}',
        fileMtime: '2024-02-01T12:00:00.000Z',
      });

      const result = getCheckpoint('new-session');

      expect(result).not.toBeNull();
      expect(result!.lastTurnIndex).toBe(3);
      expect(result!.lastChunkId).toBe('chunk-123');
    });

    it('updates existing checkpoint', () => {
      saveCheckpoint({
        sessionId: 'session-x',
        projectSlug: 'proj',
        lastTurnIndex: 1,
        lastChunkId: 'old-chunk',
        vectorClock: null,
        fileMtime: null,
      });

      saveCheckpoint({
        sessionId: 'session-x',
        projectSlug: 'proj',
        lastTurnIndex: 5,
        lastChunkId: 'new-chunk',
        vectorClock: '{"main":10}',
        fileMtime: '2024-03-01T00:00:00.000Z',
      });

      const result = getCheckpoint('session-x');

      expect(result!.lastTurnIndex).toBe(5);
      expect(result!.lastChunkId).toBe('new-chunk');
      expect(result!.vectorClock).toBe('{"main":10}');
    });
  });

  describe('deleteCheckpoint', () => {
    it('deletes existing checkpoint', () => {
      saveCheckpoint({
        sessionId: 'to-delete',
        projectSlug: 'proj',
        lastTurnIndex: 1,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });

      expect(getCheckpoint('to-delete')).not.toBeNull();

      deleteCheckpoint('to-delete');

      expect(getCheckpoint('to-delete')).toBeNull();
    });

    it('does not error on non-existent checkpoint', () => {
      expect(() => deleteCheckpoint('non-existent')).not.toThrow();
    });
  });

  describe('deleteProjectCheckpoints', () => {
    it('deletes all checkpoints for a project', () => {
      saveCheckpoint({
        sessionId: 's1',
        projectSlug: 'target-proj',
        lastTurnIndex: 1,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });
      saveCheckpoint({
        sessionId: 's2',
        projectSlug: 'target-proj',
        lastTurnIndex: 2,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });
      saveCheckpoint({
        sessionId: 's3',
        projectSlug: 'other-proj',
        lastTurnIndex: 3,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });

      deleteProjectCheckpoints('target-proj');

      expect(getCheckpoint('s1')).toBeNull();
      expect(getCheckpoint('s2')).toBeNull();
      expect(getCheckpoint('s3')).not.toBeNull();
    });
  });

  describe('getProjectCheckpoints', () => {
    it('returns all checkpoints for a project', () => {
      saveCheckpoint({
        sessionId: 'a1',
        projectSlug: 'my-proj',
        lastTurnIndex: 10,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });
      saveCheckpoint({
        sessionId: 'a2',
        projectSlug: 'my-proj',
        lastTurnIndex: 20,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });
      saveCheckpoint({
        sessionId: 'b1',
        projectSlug: 'other-proj',
        lastTurnIndex: 5,
        lastChunkId: null,
        vectorClock: null,
        fileMtime: null,
      });

      const checkpoints = getProjectCheckpoints('my-proj');

      expect(checkpoints.length).toBe(2);
      expect(checkpoints.map((c) => c.sessionId).sort()).toEqual(['a1', 'a2']);
    });

    it('returns empty array for project with no checkpoints', () => {
      const checkpoints = getProjectCheckpoints('no-checkpoints');

      expect(checkpoints).toEqual([]);
    });
  });
});
