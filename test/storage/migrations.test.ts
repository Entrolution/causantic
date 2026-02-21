/**
 * Tests for database migrations.
 *
 * Each test creates a database at a specific version and verifies
 * that runMigrations() upgrades it correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { runMigrations } from '../../src/storage/migrations.js';

// Mock the schema loader to avoid file system dependency
vi.mock('../../src/storage/schema-loader.js', () => ({
  loadSchemaStatements: vi.fn(() => []),
}));

// Mock fs for v4 migration (project directory scanning)
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      // Return false for ~/.claude/projects to skip backfill
      if (typeof path === 'string' && path.includes('.claude/projects')) return false;
      return (actual as any).existsSync(path);
    }),
    readdirSync: (actual as any).readdirSync,
    readFileSync: (actual as any).readFileSync,
  };
});

/**
 * Create a minimal v1 database with core tables.
 * This simulates a database created with the original schema.
 */
function createV1Database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (1);

    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      session_slug TEXT NOT NULL,
      turn_indices TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      content TEXT NOT NULL,
      code_block_count INTEGER DEFAULT 0,
      tool_use_count INTEGER DEFAULT 0,
      approx_tokens INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_chunks_session ON chunks(session_id);
    CREATE INDEX idx_chunks_slug ON chunks(session_slug);
    CREATE INDEX idx_chunks_time ON chunks(start_time);

    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      source_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      target_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL CHECK(edge_type IN ('backward', 'forward')),
      reference_type TEXT,
      initial_weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_chunk_id, target_chunk_id, edge_type)
    );

    CREATE INDEX idx_edges_source ON edges(source_chunk_id);
    CREATE INDEX idx_edges_target ON edges(target_chunk_id);

    CREATE TABLE clusters (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      centroid BLOB,
      exemplar_ids TEXT,
      membership_hash TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      refreshed_at TEXT
    );

    CREATE TABLE chunk_clusters (
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      distance REAL NOT NULL,
      PRIMARY KEY (chunk_id, cluster_id)
    );

    CREATE INDEX idx_chunk_clusters_cluster ON chunk_clusters(cluster_id);
  `);

  return db;
}

function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
    version: number;
  };
  return row.version;
}

function getColumnNames(db: Database.Database, table: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

function indexExists(db: Database.Database, index: string): boolean {
  const row = db
    .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='index' AND name=?")
    .get(index) as { cnt: number };
  return row.cnt > 0;
}

describe('runMigrations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fresh database (version 0)', () => {
    it('runs all migrations and reaches v9 when schema is provided', () => {
      // A fresh database starts with core tables from schema.sql
      // then migrations add versioned columns/tables
      const db = createV1Database();
      // Reset version to 0 to simulate a completely fresh database
      db.exec('DELETE FROM schema_version');
      runMigrations(db);
      expect(getSchemaVersion(db)).toBe(9);
      db.close();
    });
  });

  describe('v1 → v9', () => {
    it('upgrades through all versions', () => {
      const db = createV1Database();
      expect(getSchemaVersion(db)).toBe(1);

      runMigrations(db);

      expect(getSchemaVersion(db)).toBe(9);
      db.close();
    });

    it('adds agent_id and spawn_depth columns to chunks (v2)', () => {
      const db = createV1Database();
      runMigrations(db);

      const cols = getColumnNames(db, 'chunks');
      expect(cols).toContain('agent_id');
      expect(cols).toContain('spawn_depth');
      db.close();
    });

    it('adds link_count column to edges (v2)', () => {
      const db = createV1Database();
      runMigrations(db);

      const cols = getColumnNames(db, 'edges');
      expect(cols).toContain('link_count');
      db.close();
    });

    it('removes vector_clocks table (v7)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(tableExists(db, 'vector_clocks')).toBe(false);
      db.close();
    });

    it('removes vector_clock columns from chunks, edges, and ingestion_checkpoints (v7)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(getColumnNames(db, 'chunks')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'edges')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'ingestion_checkpoints')).not.toContain('vector_clock');
      db.close();
    });

    it('creates ingestion_checkpoints table (v3)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(tableExists(db, 'ingestion_checkpoints')).toBe(true);

      const cols = getColumnNames(db, 'ingestion_checkpoints');
      expect(cols).toContain('session_id');
      expect(cols).toContain('project_slug');
      expect(cols).toContain('last_turn_index');
      db.close();
    });

    it('creates embedding_cache table (v3)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(tableExists(db, 'embedding_cache')).toBe(true);
      db.close();
    });

    it('adds project_path column to chunks (v4)', () => {
      const db = createV1Database();
      runMigrations(db);

      const cols = getColumnNames(db, 'chunks');
      expect(cols).toContain('project_path');
      db.close();
    });

    it('creates FTS5 table (v5)', () => {
      const db = createV1Database();
      runMigrations(db);

      // FTS5 virtual tables appear in sqlite_master
      const row = db
        .prepare(
          "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
        )
        .get() as { cnt: number };
      expect(row.cnt).toBe(1);
      db.close();
    });

    it('creates composite index for session reconstruction (v6)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(indexExists(db, 'idx_chunks_slug_start_time')).toBe(true);
      db.close();
    });

    it('creates chain-walking indices on edges (v8)', () => {
      const db = createV1Database();
      runMigrations(db);

      expect(indexExists(db, 'idx_edges_source_type')).toBe(true);
      expect(indexExists(db, 'idx_edges_target_type')).toBe(true);
      db.close();
    });
  });

  describe('idempotency', () => {
    it('can run migrations multiple times without error', () => {
      const db = createV1Database();
      runMigrations(db);
      expect(getSchemaVersion(db)).toBe(9);

      // Run again — should be a no-op
      runMigrations(db);
      expect(getSchemaVersion(db)).toBe(9);
      db.close();
    });

    it('preserves data across re-runs', () => {
      const db = createV1Database();

      // Insert a chunk at v1
      db.exec(`
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('c1', 'sess1', 'proj', '[0]', '2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z', 'test content')
      `);

      runMigrations(db);

      const count = (db.prepare('SELECT count(*) as cnt FROM chunks').get() as { cnt: number }).cnt;
      expect(count).toBe(1);

      // Run again
      runMigrations(db);
      const count2 = (db.prepare('SELECT count(*) as cnt FROM chunks').get() as { cnt: number })
        .cnt;
      expect(count2).toBe(1);

      db.close();
    });
  });

  describe('partial upgrades', () => {
    it('v3 database only runs v4, v5, v6, v7, v8, v9', () => {
      const db = createV1Database();

      // Manually run through v3
      db.exec(`ALTER TABLE chunks ADD COLUMN agent_id TEXT`);
      db.exec(`ALTER TABLE chunks ADD COLUMN vector_clock TEXT`);
      db.exec(`ALTER TABLE chunks ADD COLUMN spawn_depth INTEGER DEFAULT 0`);
      db.exec(`ALTER TABLE edges ADD COLUMN vector_clock TEXT`);
      db.exec(`ALTER TABLE edges ADD COLUMN link_count INTEGER DEFAULT 1`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS vector_clocks (
          id TEXT PRIMARY KEY,
          project_slug TEXT NOT NULL,
          clock_data TEXT NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (2)`);
      db.exec(`
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
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (
          content_hash TEXT NOT NULL,
          model_id TEXT NOT NULL,
          embedding BLOB NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          hit_count INTEGER DEFAULT 0,
          PRIMARY KEY (content_hash, model_id)
        )
      `);
      db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (3)`);

      expect(getSchemaVersion(db)).toBe(3);

      runMigrations(db);

      expect(getSchemaVersion(db)).toBe(9);
      expect(getColumnNames(db, 'chunks')).toContain('project_path');
      expect(getColumnNames(db, 'chunks')).toContain('team_name');
      expect(getColumnNames(db, 'chunks')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'edges')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'ingestion_checkpoints')).not.toContain('vector_clock');
      expect(tableExists(db, 'vector_clocks')).toBe(false);
      expect(indexExists(db, 'idx_chunks_slug_start_time')).toBe(true);
      expect(indexExists(db, 'idx_chunks_agent_id')).toBe(true);
      db.close();
    });

    it('v5 database only runs v6, v7, v8, v9', () => {
      const db = createV1Database();

      // Fast-forward to v5
      db.exec(`ALTER TABLE chunks ADD COLUMN agent_id TEXT`);
      db.exec(`ALTER TABLE chunks ADD COLUMN vector_clock TEXT`);
      db.exec(`ALTER TABLE chunks ADD COLUMN spawn_depth INTEGER DEFAULT 0`);
      db.exec(`ALTER TABLE chunks ADD COLUMN project_path TEXT`);
      db.exec(`ALTER TABLE edges ADD COLUMN vector_clock TEXT`);
      db.exec(`ALTER TABLE edges ADD COLUMN link_count INTEGER DEFAULT 1`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS vector_clocks (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, clock_data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_checkpoints (session_id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, last_turn_index INTEGER NOT NULL, last_chunk_id TEXT, vector_clock TEXT, file_mtime TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (content_hash TEXT NOT NULL, model_id TEXT NOT NULL, embedding BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, hit_count INTEGER DEFAULT 0, PRIMARY KEY (content_hash, model_id))
      `);
      db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (5)`);

      expect(getSchemaVersion(db)).toBe(5);

      runMigrations(db);

      expect(getSchemaVersion(db)).toBe(9);
      expect(indexExists(db, 'idx_chunks_slug_start_time')).toBe(true);
      expect(indexExists(db, 'idx_chunks_agent_id')).toBe(true);
      expect(getColumnNames(db, 'chunks')).toContain('team_name');
      expect(getColumnNames(db, 'chunks')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'edges')).not.toContain('vector_clock');
      expect(getColumnNames(db, 'ingestion_checkpoints')).not.toContain('vector_clock');
      expect(tableExists(db, 'vector_clocks')).toBe(false);
      db.close();
    });
  });
});
