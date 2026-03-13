/**
 * Tests for migration v11 (add model_id to vectors table).
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

function createV10Database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (10);

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

    -- Simulate vectors table without model_id (pre-v11)
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      orphaned_at TEXT DEFAULT NULL,
      last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
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

function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
    version: number;
  };
  return row.version;
}

describe('migration v11', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('adds model_id column to vectors table', () => {
    const db = createV10Database();
    runMigrations(db);

    const cols = getColumnNames(db, 'vectors');
    expect(cols).toContain('model_id');
    db.close();
  });

  it('backfills existing vectors with jina-small', () => {
    const db = createV10Database();

    // Insert a vector before migration
    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('v1', embedding);

    runMigrations(db);

    const row = db.prepare('SELECT model_id FROM vectors WHERE id = ?').get('v1') as {
      model_id: string;
    };
    expect(row.model_id).toBe('jina-small');
    db.close();
  });

  it('creates idx_vectors_model index', () => {
    const db = createV10Database();
    runMigrations(db);

    expect(indexExists(db, 'idx_vectors_model')).toBe(true);
    db.close();
  });

  it('upgrades schema version to 11', () => {
    const db = createV10Database();
    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(16);
    db.close();
  });

  it('is idempotent', () => {
    const db = createV10Database();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(16);

    // Run again — should not fail
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(16);
    db.close();
  });

  it('preserves existing vector data during migration', () => {
    const db = createV10Database();

    // Insert vectors before migration
    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('v1', embedding);
    db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('v2', embedding);

    runMigrations(db);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM vectors').get() as { cnt: number };
    expect(count.cnt).toBe(2);

    // Verify embeddings are intact
    const row = db.prepare('SELECT embedding FROM vectors WHERE id = ?').get('v1') as {
      embedding: Buffer;
    };
    const restored = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.length / Float32Array.BYTES_PER_ELEMENT,
    );
    expect(restored[0]).toBeCloseTo(0.1, 5);
    db.close();
  });
});
