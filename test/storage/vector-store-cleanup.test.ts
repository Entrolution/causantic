/**
 * Tests for VectorStore cleanup/eviction paths:
 * - cleanupExpired(ttlDays)
 * - evictOldest(maxCount)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { VectorStore } from '../../src/storage/vector-store.js';
import { setDb, resetDb } from '../../src/storage/db.js';
import { serializeEmbedding } from '../../src/utils/embedding-utils.js';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestEdge,
  insertTestCluster,
  assignChunkToCluster,
} from './test-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DIMS = 512; // jina-small default

function makeEmbedding(seed: number = 0.1): number[] {
  return new Array(DIMS).fill(seed);
}

/**
 * Insert a vector row directly into the DB with a controllable last_accessed timestamp.
 * Also inserts the corresponding chunk so FK constraints are satisfied.
 */
function insertVectorWithTimestamp(
  db: Database.Database,
  id: string,
  lastAccessed: string,
  opts?: { sessionSlug?: string; agentId?: string | null; teamName?: string | null },
): void {
  // Insert chunk first (FK target for edges, cluster assignments, etc.)
  const chunk = createSampleChunk({
    id,
    sessionSlug: opts?.sessionSlug ?? 'test-project',
    agentId: opts?.agentId ?? null,
    teamName: opts?.teamName ?? null,
  });
  insertTestChunk(db, chunk);

  // Insert vector
  const blob = serializeEmbedding(makeEmbedding());
  db.prepare(
    `INSERT INTO vectors (id, embedding, last_accessed, model_id)
     VALUES (?, ?, ?, 'jina-small')`,
  ).run(id, blob, lastAccessed);
}

/** Count rows in a table. */
function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
}

/**
 * Create index_entries / index_entry_chunks / index_vectors tables
 * that the cleanup code references.
 */
function createIndexTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_entries (
      id TEXT PRIMARY KEY,
      chunk_ids TEXT NOT NULL,
      session_slug TEXT NOT NULL,
      start_time TEXT NOT NULL,
      description TEXT NOT NULL,
      approx_tokens INTEGER DEFAULT 0,
      agent_id TEXT,
      team_name TEXT,
      generation_method TEXT NOT NULL DEFAULT 'heuristic',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS index_entry_chunks (
      index_entry_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      PRIMARY KEY (index_entry_id, chunk_id)
    );
    CREATE INDEX IF NOT EXISTS idx_iec_chunk ON index_entry_chunks(chunk_id);

    CREATE TABLE IF NOT EXISTS index_vectors (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      orphaned_at TEXT DEFAULT NULL,
      last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
      model_id TEXT DEFAULT 'jina-small'
    );
  `);
}

/** Insert an index entry and its chunk mapping. */
function insertIndexEntry(db: Database.Database, indexEntryId: string, chunkIds: string[]): void {
  db.prepare(
    `INSERT INTO index_entries (id, chunk_ids, session_slug, start_time, description)
     VALUES (?, ?, 'test-project', '2024-01-01T00:00:00Z', 'test description')`,
  ).run(indexEntryId, JSON.stringify(chunkIds));

  for (const chunkId of chunkIds) {
    db.prepare(
      'INSERT OR IGNORE INTO index_entry_chunks (index_entry_id, chunk_id) VALUES (?, ?)',
    ).run(indexEntryId, chunkId);
  }
}

/** Insert an index vector (for the index_vectors table). */
function insertIndexVector(db: Database.Database, id: string): void {
  const blob = serializeEmbedding(makeEmbedding());
  db.prepare(`INSERT INTO index_vectors (id, embedding, model_id) VALUES (?, ?, 'jina-small')`).run(
    id,
    blob,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('VectorStore cleanup/eviction', () => {
  let db: Database.Database;
  let store: VectorStore;

  beforeEach(async () => {
    db = createTestDb();
    setDb(db);
    store = new VectorStore();
    // Trigger load() to create the vectors table (with TTL columns, model_id, etc.)
    await store.load();
    // Reset so subsequent calls to cleanupExpired/evictOldest will re-load from DB
    store.reset();
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  // ─── cleanupExpired ──────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('removes only vectors whose last_accessed exceeds the TTL', async () => {
      // Two expired (90 days ago), one recent (now-ish via CURRENT_TIMESTAMP)
      insertVectorWithTimestamp(db, 'old-1', '2020-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'old-2', '2020-06-15T00:00:00Z');
      insertVectorWithTimestamp(db, 'recent', new Date().toISOString());

      // Load so the store knows about all 3 vectors
      await store.load();
      expect(await store.count()).toBe(3);

      const deleted = await store.cleanupExpired(30);

      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
      expect(await store.has('recent')).toBe(true);
      expect(await store.has('old-1')).toBe(false);
      expect(await store.has('old-2')).toBe(false);

      // DB state matches memory
      expect(countRows(db, 'vectors')).toBe(1);
    });

    it('deletes associated chunks (cascade)', async () => {
      insertVectorWithTimestamp(db, 'expired-chunk', '2020-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'kept-chunk', new Date().toISOString());

      await store.load();
      const deleted = await store.cleanupExpired(30);

      expect(deleted).toBe(1);
      // The expired chunk should be gone from chunks table
      expect(countRows(db, 'chunks')).toBe(1);
      const remaining = db.prepare('SELECT id FROM chunks').all() as { id: string }[];
      expect(remaining[0].id).toBe('kept-chunk');
    });

    it('deletes edges when associated chunks are removed', async () => {
      insertVectorWithTimestamp(db, 'chunk-a', '2020-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'chunk-b', new Date().toISOString());

      // Edge between a (expired) and b (kept) — should be cascade-deleted when chunk-a goes
      insertTestEdge(db, {
        id: 'edge-1',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-b',
        edgeType: 'forward',
      });

      await store.load();
      await store.cleanupExpired(30);

      expect(countRows(db, 'edges')).toBe(0);
    });

    it('cleans up empty clusters after chunk deletion', async () => {
      insertVectorWithTimestamp(db, 'chunk-x', '2020-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'chunk-y', new Date().toISOString());

      insertTestCluster(db, { id: 'cluster-orphan', name: 'Orphan cluster' });
      insertTestCluster(db, { id: 'cluster-alive', name: 'Alive cluster' });

      assignChunkToCluster(db, 'chunk-x', 'cluster-orphan');
      assignChunkToCluster(db, 'chunk-y', 'cluster-alive');

      await store.load();
      await store.cleanupExpired(30);

      // cluster-orphan had its only member removed — should be cleaned up
      expect(countRows(db, 'clusters')).toBe(1);
      const remaining = db.prepare('SELECT id FROM clusters').all() as { id: string }[];
      expect(remaining[0].id).toBe('cluster-alive');
    });

    it('cleans up orphaned index entries', async () => {
      createIndexTables(db);

      insertVectorWithTimestamp(db, 'chunk-1', '2020-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'chunk-2', new Date().toISOString());

      // Index entry referencing only the expired chunk — should become orphaned
      insertIndexEntry(db, 'ie-orphan', ['chunk-1']);
      // Index entry referencing the kept chunk — should survive
      insertIndexEntry(db, 'ie-alive', ['chunk-2']);

      await store.load();
      await store.cleanupExpired(30);

      expect(countRows(db, 'index_entries')).toBe(1);
      const remaining = db.prepare('SELECT id FROM index_entries').all() as { id: string }[];
      expect(remaining[0].id).toBe('ie-alive');

      // Reverse-lookup rows for the expired chunk should be gone
      expect(countRows(db, 'index_entry_chunks')).toBe(1);
    });

    it('cleans up orphaned index_vectors entries when tableName is vectors', async () => {
      createIndexTables(db);

      insertVectorWithTimestamp(db, 'chunk-1', '2020-01-01T00:00:00Z');

      insertIndexEntry(db, 'ie-orphan', ['chunk-1']);
      insertIndexVector(db, 'ie-orphan');

      await store.load();
      await store.cleanupExpired(30);

      expect(countRows(db, 'index_vectors')).toBe(0);
    });

    it('returns 0 and does nothing when no vectors are expired', async () => {
      insertVectorWithTimestamp(db, 'fresh-1', new Date().toISOString());
      insertVectorWithTimestamp(db, 'fresh-2', new Date().toISOString());

      await store.load();
      const deleted = await store.cleanupExpired(30);

      expect(deleted).toBe(0);
      expect(await store.count()).toBe(2);
      expect(countRows(db, 'chunks')).toBe(2);
    });

    it('removes all vectors when all are expired', async () => {
      insertVectorWithTimestamp(db, 'old-a', '2019-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'old-b', '2019-06-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'old-c', '2020-01-01T00:00:00Z');

      await store.load();
      const deleted = await store.cleanupExpired(30);

      expect(deleted).toBe(3);
      expect(await store.count()).toBe(0);
      expect(countRows(db, 'vectors')).toBe(0);
      expect(countRows(db, 'chunks')).toBe(0);
    });

    it('removes expired IDs from the chunkProjectIndex', async () => {
      insertVectorWithTimestamp(db, 'expired', '2020-01-01T00:00:00Z', {
        sessionSlug: 'my-project',
      });
      insertVectorWithTimestamp(db, 'kept', new Date().toISOString(), {
        sessionSlug: 'my-project',
      });

      await store.load();
      await store.cleanupExpired(30);

      // Verify via has() that the expired vector is gone from memory
      expect(await store.has('expired')).toBe(false);
      expect(await store.has('kept')).toBe(true);
    });
  });

  // ─── evictOldest ─────────────────────────────────────────────────────────

  describe('evictOldest', () => {
    it('evicts the oldest vectors when count exceeds maxCount', async () => {
      // Insert 5 vectors with staggered timestamps (oldest first)
      insertVectorWithTimestamp(db, 'v1', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v2', '2024-02-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v3', '2024-03-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v4', '2024-04-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v5', '2024-05-01T00:00:00Z');

      await store.load();
      expect(await store.count()).toBe(5);

      const evicted = await store.evictOldest(3);

      expect(evicted).toBe(2);
      expect(await store.count()).toBe(3);

      // The two oldest (v1, v2) should be gone
      expect(await store.has('v1')).toBe(false);
      expect(await store.has('v2')).toBe(false);
      // The three newest should remain
      expect(await store.has('v3')).toBe(true);
      expect(await store.has('v4')).toBe(true);
      expect(await store.has('v5')).toBe(true);

      // DB matches memory
      expect(countRows(db, 'vectors')).toBe(3);
      expect(countRows(db, 'chunks')).toBe(3);
    });

    it('cascades chunk, edge, and cluster deletion', async () => {
      insertVectorWithTimestamp(db, 'old-chunk', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'new-chunk', '2024-12-01T00:00:00Z');

      insertTestEdge(db, {
        id: 'edge-1',
        sourceChunkId: 'old-chunk',
        targetChunkId: 'new-chunk',
        edgeType: 'forward',
      });

      insertTestCluster(db, { id: 'cluster-solo', name: 'Solo' });
      assignChunkToCluster(db, 'old-chunk', 'cluster-solo');

      insertTestCluster(db, { id: 'cluster-shared', name: 'Shared' });
      assignChunkToCluster(db, 'new-chunk', 'cluster-shared');

      await store.load();
      const evicted = await store.evictOldest(1);

      expect(evicted).toBe(1);
      expect(countRows(db, 'edges')).toBe(0);
      // cluster-solo lost its only member — should be cleaned up
      expect(countRows(db, 'clusters')).toBe(1);
      const remaining = db.prepare('SELECT id FROM clusters').all() as { id: string }[];
      expect(remaining[0].id).toBe('cluster-shared');
    });

    it('cleans up orphaned index entries', async () => {
      createIndexTables(db);

      insertVectorWithTimestamp(db, 'v-old', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v-new', '2024-12-01T00:00:00Z');

      insertIndexEntry(db, 'ie-orphan', ['v-old']);
      insertIndexEntry(db, 'ie-alive', ['v-new']);
      insertIndexVector(db, 'ie-orphan');

      await store.load();
      await store.evictOldest(1);

      expect(countRows(db, 'index_entries')).toBe(1);
      expect(countRows(db, 'index_vectors')).toBe(0);
    });

    it('returns 0 when count is already within maxCount', async () => {
      insertVectorWithTimestamp(db, 'v1', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v2', '2024-02-01T00:00:00Z');

      await store.load();
      const evicted = await store.evictOldest(5);

      expect(evicted).toBe(0);
      expect(await store.count()).toBe(2);
    });

    it('returns 0 when count equals maxCount exactly', async () => {
      insertVectorWithTimestamp(db, 'v1', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'v2', '2024-02-01T00:00:00Z');

      await store.load();
      const evicted = await store.evictOldest(2);

      expect(evicted).toBe(0);
      expect(await store.count()).toBe(2);
    });

    it('returns 0 when maxCount is 0 (unlimited)', async () => {
      insertVectorWithTimestamp(db, 'v1', '2024-01-01T00:00:00Z');

      await store.load();
      const evicted = await store.evictOldest(0);

      expect(evicted).toBe(0);
      expect(await store.count()).toBe(1);
    });

    it('returns 0 when maxCount is negative', async () => {
      insertVectorWithTimestamp(db, 'v1', '2024-01-01T00:00:00Z');

      await store.load();
      const evicted = await store.evictOldest(-1);

      expect(evicted).toBe(0);
      expect(await store.count()).toBe(1);
    });

    it('evicts all but maxCount=1', async () => {
      insertVectorWithTimestamp(db, 'oldest', '2024-01-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'middle', '2024-06-01T00:00:00Z');
      insertVectorWithTimestamp(db, 'newest', '2024-12-01T00:00:00Z');

      await store.load();
      const evicted = await store.evictOldest(1);

      expect(evicted).toBe(2);
      expect(await store.count()).toBe(1);
      expect(await store.has('newest')).toBe(true);
      expect(await store.has('oldest')).toBe(false);
      expect(await store.has('middle')).toBe(false);
    });

    it('removes evicted IDs from memory indices', async () => {
      insertVectorWithTimestamp(db, 'evicted', '2024-01-01T00:00:00Z', {
        sessionSlug: 'proj-a',
      });
      insertVectorWithTimestamp(db, 'kept', '2024-12-01T00:00:00Z', {
        sessionSlug: 'proj-b',
      });

      await store.load();
      await store.evictOldest(1);

      expect(await store.has('evicted')).toBe(false);
      expect(await store.has('kept')).toBe(true);
    });
  });
});
