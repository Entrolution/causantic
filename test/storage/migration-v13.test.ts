/**
 * Tests for migration v13 (add retrieval_feedback table for relevance learning).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { runMigrations } from '../../src/storage/migrations.js';

// Mock the schema loader to avoid file system dependency
vi.mock('../../src/storage/schema-loader.js', () => ({
  loadSchemaStatements: vi.fn(() => []),
}));

// Mock fs for v4 migration
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.includes('.claude/projects')) return false;
      return (actual as any).existsSync(path);
    }),
    readdirSync: (actual as any).readdirSync,
    readFileSync: (actual as any).readFileSync,
  };
});

function createV12Database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (12);

    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      session_slug TEXT NOT NULL,
      turn_indices TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      agent_id TEXT,
      spawn_depth INTEGER DEFAULT 0,
      project_path TEXT,
      team_name TEXT
    );

    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      source_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      target_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      reference_type TEXT,
      initial_weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      link_count INTEGER DEFAULT 1
    );

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

    CREATE TABLE ingestion_checkpoints (
      session_id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      last_turn_index INTEGER NOT NULL,
      last_chunk_id TEXT,
      file_mtime TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE embedding_cache (
      content_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      hit_count INTEGER DEFAULT 0,
      PRIMARY KEY (content_hash, model_id)
    );

    CREATE TABLE hdbscan_models (
      project_id TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      model_blob BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, embedding_model)
    );
  `);

  return db;
}

function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
    version: number;
  };
  return row.version;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

function getColumnNames(db: Database.Database, table: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

function indexExists(db: Database.Database, index: string): boolean {
  const row = db
    .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='index' AND name=?")
    .get(index) as { cnt: number };
  return row.cnt > 0;
}

describe('migration v13', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates retrieval_feedback table', () => {
    const db = createV12Database();
    runMigrations(db);

    expect(tableExists(db, 'retrieval_feedback')).toBe(true);
    db.close();
  });

  it('retrieval_feedback table has correct columns', () => {
    const db = createV12Database();
    runMigrations(db);

    const cols = getColumnNames(db, 'retrieval_feedback');
    expect(cols).toContain('chunk_id');
    expect(cols).toContain('query_hash');
    expect(cols).toContain('returned_at');
    expect(cols).toContain('tool_name');
    db.close();
  });

  it('creates chunk and returned_at indexes', () => {
    const db = createV12Database();
    runMigrations(db);

    expect(indexExists(db, 'idx_retrieval_feedback_chunk')).toBe(true);
    expect(indexExists(db, 'idx_retrieval_feedback_returned')).toBe(true);
    db.close();
  });

  it('upgrades schema version to 13', () => {
    const db = createV12Database();
    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(15);
    db.close();
  });

  it('is idempotent', () => {
    const db = createV12Database();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(15);

    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(15);
    db.close();
  });

  it('can insert and query feedback data', () => {
    const db = createV12Database();
    runMigrations(db);

    // Insert a chunk first (for FK)
    db.prepare(
      "INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content) VALUES ('c1', 's1', 'proj', '[0]', '2024-01-01', '2024-01-01', 'test')",
    ).run();

    db.prepare(
      "INSERT INTO retrieval_feedback (chunk_id, query_hash, tool_name) VALUES ('c1', 'abc12345', 'search')",
    ).run();

    const count = db.prepare('SELECT COUNT(*) as cnt FROM retrieval_feedback').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(1);

    db.close();
  });
});
