/**
 * Tests for index entry store CRUD operations and FTS5 keyword search.
 * Uses real in-memory SQLite with the full schema — no database mocking.
 * The vector store is mocked since it requires external resources.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  setupTestDb,
  teardownTestDb,
} from './test-utils.js';
import type { IndexEntryInput } from '../../src/storage/types.js';

// Mock the vector store (used by delete operations)
vi.mock('../../src/storage/vector-store.js', () => ({
  indexVectorStore: {
    delete: vi.fn(async () => {}),
    deleteBatch: vi.fn(async () => {}),
  },
  vectorStore: {
    delete: vi.fn(async () => {}),
    deleteBatch: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    searchByProject: vi.fn(async () => []),
    setModelId: vi.fn(),
  },
}));

// Import store functions after mock setup
import {
  insertIndexEntry,
  insertIndexEntries,
  getIndexEntryById,
  getIndexEntriesByIds,
  getIndexEntriesForChunk,
  getIndexEntriesBySession,
  getIndexEntryCount,
  getIndexedChunkCount,
  getUnindexedChunkIds,
  deleteIndexEntry,
  deleteIndexEntriesForChunks,
  dereferenceToChunkIds,
  searchIndexEntriesByKeyword,
} from '../../src/storage/index-entry-store.js';
import { indexVectorStore } from '../../src/storage/vector-store.js';

/**
 * Add index_entries, index_entry_chunks, and index_entries_fts schema
 * to the test database (not included in the base test-utils schema).
 */
function addIndexEntrySchema(db: Database.Database): void {
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

    CREATE INDEX IF NOT EXISTS idx_index_entries_slug ON index_entries(session_slug);
    CREATE INDEX IF NOT EXISTS idx_index_entries_method ON index_entries(generation_method);

    CREATE TABLE IF NOT EXISTS index_entry_chunks (
      index_entry_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      PRIMARY KEY (index_entry_id, chunk_id)
    );

    CREATE INDEX IF NOT EXISTS idx_iec_chunk ON index_entry_chunks(chunk_id);
  `);

  // FTS5 on descriptions with sync triggers
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS index_entries_fts USING fts5(
        description,
        content='index_entries',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS index_entries_ai AFTER INSERT ON index_entries BEGIN
        INSERT INTO index_entries_fts(rowid, description) VALUES (new.rowid, new.description);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS index_entries_ad AFTER DELETE ON index_entries BEGIN
        INSERT INTO index_entries_fts(index_entries_fts, rowid, description) VALUES('delete', old.rowid, old.description);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS index_entries_au AFTER UPDATE OF description ON index_entries BEGIN
        INSERT INTO index_entries_fts(index_entries_fts, rowid, description) VALUES('delete', old.rowid, old.description);
        INSERT INTO index_entries_fts(rowid, description) VALUES (new.rowid, new.description);
      END;
    `);
  } catch {
    // FTS5 may not be available in all SQLite builds
  }
}

/** Create a sample IndexEntryInput with sensible defaults. */
function createSampleIndexEntry(
  overrides: Partial<IndexEntryInput> & { chunkIds?: string[] } = {},
): IndexEntryInput {
  return {
    chunkIds: overrides.chunkIds ?? ['chunk-1'],
    sessionSlug: overrides.sessionSlug ?? 'test-project',
    startTime: overrides.startTime ?? '2025-01-01T00:00:00Z',
    description: overrides.description ?? 'Test index entry description',
    approxTokens: overrides.approxTokens ?? 50,
    agentId: overrides.agentId ?? null,
    teamName: overrides.teamName ?? null,
    generationMethod: overrides.generationMethod ?? 'heuristic',
  };
}

describe('index-entry-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    addIndexEntrySchema(db);
    setupTestDb(db);
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  // ─── insertIndexEntry ───────────────────────────────────────────────

  describe('insertIndexEntry', () => {
    it('inserts and returns a generated ID', () => {
      const id = insertIndexEntry(createSampleIndexEntry());
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('round-trips all fields correctly', () => {
      const input = createSampleIndexEntry({
        chunkIds: ['c1', 'c2'],
        sessionSlug: 'my-project',
        startTime: '2025-06-15T12:00:00Z',
        description: 'Implemented caching layer for database queries',
        approxTokens: 120,
        agentId: 'researcher',
        teamName: 'backend-team',
        generationMethod: 'llm',
      });

      const id = insertIndexEntry(input);
      const entry = getIndexEntryById(id);

      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(id);
      expect(entry!.chunkIds).toEqual(['c1', 'c2']);
      expect(entry!.sessionSlug).toBe('my-project');
      expect(entry!.startTime).toBe('2025-06-15T12:00:00Z');
      expect(entry!.description).toBe('Implemented caching layer for database queries');
      expect(entry!.approxTokens).toBe(120);
      expect(entry!.agentId).toBe('researcher');
      expect(entry!.teamName).toBe('backend-team');
      expect(entry!.generationMethod).toBe('llm');
      expect(entry!.createdAt).toBeDefined();
    });

    it('stores null for optional fields when not provided', () => {
      const id = insertIndexEntry(
        createSampleIndexEntry({ agentId: undefined, teamName: undefined }),
      );
      const entry = getIndexEntryById(id);

      expect(entry!.agentId).toBeNull();
      expect(entry!.teamName).toBeNull();
    });

    it('serializes chunkIds as JSON', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['a', 'b', 'c'] }));

      const row = db.prepare('SELECT chunk_ids FROM index_entries WHERE id = ?').get(id) as {
        chunk_ids: string;
      };
      expect(JSON.parse(row.chunk_ids)).toEqual(['a', 'b', 'c']);
    });

    it('populates the reverse lookup table', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));

      const rows = db
        .prepare(
          'SELECT chunk_id FROM index_entry_chunks WHERE index_entry_id = ? ORDER BY chunk_id',
        )
        .all(id) as Array<{ chunk_id: string }>;

      expect(rows.map((r) => r.chunk_id)).toEqual(['c1', 'c2']);
    });
  });

  // ─── insertIndexEntries ─────────────────────────────────────────────

  describe('insertIndexEntries', () => {
    it('returns empty array for empty input', () => {
      const ids = insertIndexEntries([]);
      expect(ids).toEqual([]);
    });

    it('inserts multiple entries in a transaction', () => {
      const inputs = [
        createSampleIndexEntry({ description: 'First entry', chunkIds: ['c1'] }),
        createSampleIndexEntry({ description: 'Second entry', chunkIds: ['c2'] }),
        createSampleIndexEntry({ description: 'Third entry', chunkIds: ['c3'] }),
      ];

      const ids = insertIndexEntries(inputs);

      expect(ids).toHaveLength(3);
      expect(getIndexEntryCount()).toBe(3);
    });

    it('generates unique IDs for each entry', () => {
      const inputs = [
        createSampleIndexEntry({ description: 'A' }),
        createSampleIndexEntry({ description: 'B' }),
      ];

      const ids = insertIndexEntries(inputs);
      expect(new Set(ids).size).toBe(2);
    });

    it('populates reverse lookup for all entries', () => {
      const inputs = [
        createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }),
        createSampleIndexEntry({ chunkIds: ['c3'] }),
      ];

      const ids = insertIndexEntries(inputs);

      const rows = db.prepare('SELECT * FROM index_entry_chunks ORDER BY chunk_id').all() as Array<{
        index_entry_id: string;
        chunk_id: string;
      }>;

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.chunk_id)).toEqual(['c1', 'c2', 'c3']);
      expect(rows[0].index_entry_id).toBe(ids[0]);
      expect(rows[1].index_entry_id).toBe(ids[0]);
      expect(rows[2].index_entry_id).toBe(ids[1]);
    });
  });

  // ─── getIndexEntryById ──────────────────────────────────────────────

  describe('getIndexEntryById', () => {
    it('returns the entry when it exists', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ description: 'exists' }));
      const entry = getIndexEntryById(id);
      expect(entry).not.toBeNull();
      expect(entry!.description).toBe('exists');
    });

    it('returns null for non-existent ID', () => {
      const entry = getIndexEntryById('non-existent-id');
      expect(entry).toBeNull();
    });
  });

  // ─── getIndexEntriesByIds ───────────────────────────────────────────

  describe('getIndexEntriesByIds', () => {
    it('returns empty array for empty input', () => {
      const entries = getIndexEntriesByIds([]);
      expect(entries).toEqual([]);
    });

    it('returns matching entries', () => {
      const id1 = insertIndexEntry(createSampleIndexEntry({ description: 'First' }));
      const id2 = insertIndexEntry(createSampleIndexEntry({ description: 'Second' }));
      insertIndexEntry(createSampleIndexEntry({ description: 'Third' }));

      const entries = getIndexEntriesByIds([id1, id2]);
      expect(entries).toHaveLength(2);

      const descriptions = entries.map((e) => e.description).sort();
      expect(descriptions).toEqual(['First', 'Second']);
    });

    it('ignores non-existent IDs', () => {
      const id = insertIndexEntry(createSampleIndexEntry());
      const entries = getIndexEntriesByIds([id, 'does-not-exist']);
      expect(entries).toHaveLength(1);
    });

    it('handles all non-existent IDs gracefully', () => {
      const entries = getIndexEntriesByIds(['fake-1', 'fake-2']);
      expect(entries).toEqual([]);
    });
  });

  // ─── getIndexEntriesForChunk ────────────────────────────────────────

  describe('getIndexEntriesForChunk', () => {
    it('returns entries linked to a chunk via reverse lookup', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['target-chunk'] }));
      const entries = getIndexEntriesForChunk('target-chunk');

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(id);
    });

    it('returns multiple entries when a chunk is covered by several entries', () => {
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['shared-chunk', 'other-1'] }));
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['shared-chunk', 'other-2'] }));

      const entries = getIndexEntriesForChunk('shared-chunk');
      expect(entries).toHaveLength(2);
    });

    it('returns empty array for chunk with no entries', () => {
      const entries = getIndexEntriesForChunk('orphan-chunk');
      expect(entries).toEqual([]);
    });
  });

  // ─── getIndexEntriesBySession ───────────────────────────────────────

  describe('getIndexEntriesBySession', () => {
    it('returns entries for the given session slug', () => {
      insertIndexEntry(createSampleIndexEntry({ sessionSlug: 'proj-a', description: 'A1' }));
      insertIndexEntry(createSampleIndexEntry({ sessionSlug: 'proj-a', description: 'A2' }));
      insertIndexEntry(createSampleIndexEntry({ sessionSlug: 'proj-b', description: 'B1' }));

      const entries = getIndexEntriesBySession('proj-a');
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.sessionSlug === 'proj-a')).toBe(true);
    });

    it('orders results by start_time', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj',
          startTime: '2025-03-01T00:00:00Z',
          description: 'later',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj',
          startTime: '2025-01-01T00:00:00Z',
          description: 'earlier',
        }),
      );

      const entries = getIndexEntriesBySession('proj');
      expect(entries[0].description).toBe('earlier');
      expect(entries[1].description).toBe('later');
    });

    it('returns empty array for unknown session', () => {
      const entries = getIndexEntriesBySession('nonexistent');
      expect(entries).toEqual([]);
    });
  });

  // ─── getIndexEntryCount ─────────────────────────────────────────────

  describe('getIndexEntryCount', () => {
    it('returns 0 for empty database', () => {
      expect(getIndexEntryCount()).toBe(0);
    });

    it('returns correct count', () => {
      insertIndexEntry(createSampleIndexEntry());
      insertIndexEntry(createSampleIndexEntry());
      insertIndexEntry(createSampleIndexEntry());

      expect(getIndexEntryCount()).toBe(3);
    });
  });

  // ─── getIndexedChunkCount ───────────────────────────────────────────

  describe('getIndexedChunkCount', () => {
    it('returns 0 when no index entries exist', () => {
      expect(getIndexedChunkCount()).toBe(0);
    });

    it('counts distinct chunks that have entries', () => {
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c2', 'c3'] }));

      // c1, c2, c3 = 3 distinct chunks (c2 is shared but counted once)
      expect(getIndexedChunkCount()).toBe(3);
    });
  });

  // ─── getUnindexedChunkIds ───────────────────────────────────────────

  describe('getUnindexedChunkIds', () => {
    it('returns chunk IDs that have no index entries', () => {
      // Insert actual chunks into the chunks table
      insertTestChunk(db, createSampleChunk({ id: 'indexed-chunk' }));
      insertTestChunk(db, createSampleChunk({ id: 'unindexed-1' }));
      insertTestChunk(db, createSampleChunk({ id: 'unindexed-2' }));

      // Only index one of them
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['indexed-chunk'] }));

      const unindexed = getUnindexedChunkIds(10);
      expect(unindexed).toHaveLength(2);
      expect(unindexed).toContain('unindexed-1');
      expect(unindexed).toContain('unindexed-2');
    });

    it('respects the limit parameter', () => {
      insertTestChunk(db, createSampleChunk({ id: 'u1' }));
      insertTestChunk(db, createSampleChunk({ id: 'u2' }));
      insertTestChunk(db, createSampleChunk({ id: 'u3' }));

      const unindexed = getUnindexedChunkIds(2);
      expect(unindexed).toHaveLength(2);
    });

    it('returns empty array when all chunks are indexed', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));

      const unindexed = getUnindexedChunkIds(10);
      expect(unindexed).toEqual([]);
    });

    it('returns empty array when no chunks exist', () => {
      const unindexed = getUnindexedChunkIds(10);
      expect(unindexed).toEqual([]);
    });
  });

  // ─── deleteIndexEntry ───────────────────────────────────────────────

  describe('deleteIndexEntry', () => {
    it('deletes an existing entry and returns true', async () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      expect(getIndexEntryById(id)).not.toBeNull();

      const deleted = await deleteIndexEntry(id);
      expect(deleted).toBe(true);
      expect(getIndexEntryById(id)).toBeNull();
    });

    it('removes reverse lookup rows', async () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));

      const beforeRows = db
        .prepare('SELECT * FROM index_entry_chunks WHERE index_entry_id = ?')
        .all(id);
      expect(beforeRows).toHaveLength(2);

      await deleteIndexEntry(id);

      const afterRows = db
        .prepare('SELECT * FROM index_entry_chunks WHERE index_entry_id = ?')
        .all(id);
      expect(afterRows).toHaveLength(0);
    });

    it('calls vectorStore.delete with the entry ID', async () => {
      const id = insertIndexEntry(createSampleIndexEntry());
      await deleteIndexEntry(id);

      expect(indexVectorStore.delete).toHaveBeenCalledWith(id);
    });

    it('returns false for non-existent entry', async () => {
      const deleted = await deleteIndexEntry('nonexistent');
      expect(deleted).toBe(false);
    });

    it('does not call vectorStore.delete for non-existent entry', async () => {
      await deleteIndexEntry('nonexistent');
      expect(indexVectorStore.delete).not.toHaveBeenCalled();
    });
  });

  // ─── deleteIndexEntriesForChunks ────────────────────────────────────

  describe('deleteIndexEntriesForChunks', () => {
    it('returns 0 for empty input', async () => {
      const count = await deleteIndexEntriesForChunks([]);
      expect(count).toBe(0);
    });

    it('deletes orphaned entries when all their chunks are removed', async () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      expect(getIndexEntryById(id)).not.toBeNull();

      const count = await deleteIndexEntriesForChunks(['c1']);
      expect(count).toBe(1);
      expect(getIndexEntryById(id)).toBeNull();
    });

    it('does not delete entries that still have remaining chunk references', async () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));

      const count = await deleteIndexEntriesForChunks(['c1']);
      expect(count).toBe(0);

      // Entry should still exist
      const entry = getIndexEntryById(id);
      expect(entry).not.toBeNull();

      // chunk_ids JSON should be updated to only contain c2
      expect(entry!.chunkIds).toEqual(['c2']);
    });

    it('calls vectorStore.deleteBatch for orphaned entries', async () => {
      const id1 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      const id2 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c2'] }));

      await deleteIndexEntriesForChunks(['c1', 'c2']);

      expect(indexVectorStore.deleteBatch).toHaveBeenCalledWith(expect.arrayContaining([id1, id2]));
    });

    it('returns 0 when chunk IDs do not match any entries', async () => {
      insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      const count = await deleteIndexEntriesForChunks(['nonexistent']);
      expect(count).toBe(0);
    });

    it('handles mixed orphaned and surviving entries', async () => {
      // Entry 1: will become orphaned (only has c1)
      const id1 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      // Entry 2: will survive (has c2 and c3, only c2 is removed)
      const id2 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c2', 'c3'] }));

      const count = await deleteIndexEntriesForChunks(['c1', 'c2']);
      expect(count).toBe(1); // Only entry 1 orphaned

      expect(getIndexEntryById(id1)).toBeNull();
      const surviving = getIndexEntryById(id2);
      expect(surviving).not.toBeNull();
      expect(surviving!.chunkIds).toEqual(['c3']);
    });
  });

  // ─── dereferenceToChunkIds ──────────────────────────────────────────

  describe('dereferenceToChunkIds', () => {
    it('returns empty array for empty input', () => {
      expect(dereferenceToChunkIds([])).toEqual([]);
    });

    it('returns chunk IDs from a single entry', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));
      const chunkIds = dereferenceToChunkIds([id]);
      expect(chunkIds).toEqual(['c1', 'c2']);
    });

    it('deduplicates chunk IDs across entries', () => {
      const id1 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1', 'c2'] }));
      const id2 = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c2', 'c3'] }));

      const chunkIds = dereferenceToChunkIds([id1, id2]);
      expect(chunkIds).toHaveLength(3);
      expect(new Set(chunkIds)).toEqual(new Set(['c1', 'c2', 'c3']));
    });

    it('ignores non-existent entry IDs', () => {
      const id = insertIndexEntry(createSampleIndexEntry({ chunkIds: ['c1'] }));
      const chunkIds = dereferenceToChunkIds([id, 'nonexistent']);
      expect(chunkIds).toEqual(['c1']);
    });
  });

  // ─── searchIndexEntriesByKeyword (FTS5) ─────────────────────────────

  describe('searchIndexEntriesByKeyword', () => {
    it('finds entries matching a single keyword', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Implemented database caching layer for PostgreSQL queries',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Fixed authentication bug in login flow',
        }),
      );

      const results = searchIndexEntriesByKeyword('caching', 10);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('finds entries matching multiple keywords', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Implemented database caching layer',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Optimised database connection pooling',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Updated frontend styling',
        }),
      );

      const results = searchIndexEntriesByKeyword('database caching', 10);
      // Both database entries should match, but the one with both keywords should score higher
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('returns results ordered by relevance (BM25 score)', () => {
      // Entry with both keywords should score higher
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Implemented database caching layer for database performance',
        }),
      );
      // Entry with only one keyword
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Updated frontend configuration file',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          description: 'Database migration scripts for schema changes',
        }),
      );

      const results = searchIndexEntriesByKeyword('database', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Scores should be in descending order (highest relevance first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('filters by project (session slug)', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-a',
          description: 'Database caching implementation',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-b',
          description: 'Database migration scripts',
        }),
      );

      const results = searchIndexEntriesByKeyword('database', 10, 'proj-a');
      expect(results).toHaveLength(1);

      // Verify it is the proj-a entry
      const entry = getIndexEntryById(results[0].id);
      expect(entry!.sessionSlug).toBe('proj-a');
    });

    it('filters by multiple projects (array)', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-a',
          description: 'Database caching',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-b',
          description: 'Database migration',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-c',
          description: 'Database indexing',
        }),
      );

      const results = searchIndexEntriesByKeyword('database', 10, ['proj-a', 'proj-b']);
      expect(results).toHaveLength(2);

      const ids = results.map((r) => r.id);
      const slugs = ids.map((id) => getIndexEntryById(id)!.sessionSlug);
      expect(slugs.sort()).toEqual(['proj-a', 'proj-b']);
    });

    it('filters by agent ID', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          agentId: 'researcher',
          description: 'Database analysis report',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          agentId: 'coder',
          description: 'Database schema refactoring',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          agentId: null,
          description: 'Database backup strategy',
        }),
      );

      const results = searchIndexEntriesByKeyword('database', 10, undefined, 'researcher');
      expect(results).toHaveLength(1);

      const entry = getIndexEntryById(results[0].id);
      expect(entry!.agentId).toBe('researcher');
    });

    it('combines project and agent filters', () => {
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-a',
          agentId: 'researcher',
          description: 'Database analysis',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-a',
          agentId: 'coder',
          description: 'Database refactoring',
        }),
      );
      insertIndexEntry(
        createSampleIndexEntry({
          sessionSlug: 'proj-b',
          agentId: 'researcher',
          description: 'Database review',
        }),
      );

      const results = searchIndexEntriesByKeyword('database', 10, 'proj-a', 'researcher');
      expect(results).toHaveLength(1);
    });

    it('returns empty array for empty query', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'something' }));
      const results = searchIndexEntriesByKeyword('', 10);
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only query', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'something' }));
      const results = searchIndexEntriesByKeyword('   ', 10);
      expect(results).toEqual([]);
    });

    it('sanitizes FTS5 special operators from query', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'Testing search implementation' }));

      // These contain FTS5 operators that should be stripped
      const results = searchIndexEntriesByKeyword('AND OR NOT', 10);
      expect(results).toEqual([]);
    });

    it('sanitizes special characters from query', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'Implemented search feature' }));

      // Query with special FTS5 syntax characters
      const results = searchIndexEntriesByKeyword('search*"test"', 10);
      // Should not throw — "search" and "test" should be extracted as plain terms
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles query with only special characters gracefully', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'something' }));
      const results = searchIndexEntriesByKeyword('***""{()}', 10);
      expect(results).toEqual([]);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertIndexEntry(createSampleIndexEntry({ description: `Database operation number ${i}` }));
      }

      const results = searchIndexEntriesByKeyword('database', 3);
      expect(results).toHaveLength(3);
    });

    it('returns positive scores (negated BM25)', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'Implemented search functionality' }));

      const results = searchIndexEntriesByKeyword('search', 10);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('uses porter stemming (matches stemmed variants)', () => {
      insertIndexEntry(
        createSampleIndexEntry({ description: 'Implementing database caching strategies' }),
      );

      // "implement" should match "implementing" via porter stemmer
      const results = searchIndexEntriesByKeyword('implement', 10);
      expect(results).toHaveLength(1);
    });

    it('returns no results when no entries match', () => {
      insertIndexEntry(createSampleIndexEntry({ description: 'Frontend styling changes' }));

      const results = searchIndexEntriesByKeyword('database', 10);
      expect(results).toEqual([]);
    });
  });
});
