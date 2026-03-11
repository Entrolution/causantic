/**
 * Tests for migration v12 (add hdbscan_models table for incremental clustering).
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

function createV11Database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (11);

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

    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      orphaned_at TEXT DEFAULT NULL,
      last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
      model_id TEXT DEFAULT 'jina-small'
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

describe('migration v12', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates hdbscan_models table', () => {
    const db = createV11Database();
    runMigrations(db);

    expect(tableExists(db, 'hdbscan_models')).toBe(true);
    db.close();
  });

  it('hdbscan_models table has correct columns', () => {
    const db = createV11Database();
    runMigrations(db);

    const cols = getColumnNames(db, 'hdbscan_models');
    expect(cols).toContain('project_id');
    expect(cols).toContain('embedding_model');
    expect(cols).toContain('model_blob');
    expect(cols).toContain('created_at');
    expect(cols).toContain('chunk_count');
    db.close();
  });

  it('upgrades schema version to 12', () => {
    const db = createV11Database();
    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(14);
    db.close();
  });

  it('is idempotent', () => {
    const db = createV11Database();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(14);

    // Run again
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(14);
    db.close();
  });

  it('supports composite primary key (project_id, embedding_model)', () => {
    const db = createV11Database();
    runMigrations(db);

    const blob = Buffer.from('{}');
    db.prepare(
      'INSERT INTO hdbscan_models (project_id, embedding_model, model_blob, chunk_count) VALUES (?, ?, ?, ?)',
    ).run('proj-1', 'jina-small', blob, 100);

    db.prepare(
      'INSERT INTO hdbscan_models (project_id, embedding_model, model_blob, chunk_count) VALUES (?, ?, ?, ?)',
    ).run('proj-1', 'nomic-v1.5', blob, 200);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM hdbscan_models').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(2);

    // Duplicate should fail (or replace with INSERT OR REPLACE)
    expect(() => {
      db.prepare(
        'INSERT INTO hdbscan_models (project_id, embedding_model, model_blob, chunk_count) VALUES (?, ?, ?, ?)',
      ).run('proj-1', 'jina-small', blob, 300);
    }).toThrow();

    db.close();
  });
});
