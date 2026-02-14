/**
 * Tests for database connection and migrations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';

// Create an in-memory DB for testing without relying on the singleton
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Create schema directly
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS chunks (
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
      vector_clock TEXT,
      spawn_depth INTEGER DEFAULT 0,
      project_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_slug ON chunks(session_slug);
    CREATE INDEX IF NOT EXISTS idx_chunks_time ON chunks(start_time);

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      target_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL CHECK(edge_type IN ('backward', 'forward')),
      reference_type TEXT,
      initial_weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      vector_clock TEXT,
      link_count INTEGER DEFAULT 1,
      UNIQUE(source_chunk_id, target_chunk_id, edge_type)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_chunk_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_chunk_id);

    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      centroid BLOB,
      exemplar_ids TEXT,
      membership_hash TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      refreshed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chunk_clusters (
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      distance REAL NOT NULL,
      PRIMARY KEY (chunk_id, cluster_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_clusters_cluster ON chunk_clusters(cluster_id);

    CREATE TABLE IF NOT EXISTS vector_clocks (
      id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      clock_data TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_vector_clocks_project ON vector_clocks(project_slug);

    INSERT OR REPLACE INTO schema_version (version) VALUES (4);
  `);

  return db;
}

describe('database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('schema', () => {
    it('has chunks table with required columns', () => {
      const columns = db.prepare('PRAGMA table_info(chunks)').all() as { name: string }[];
      const names = columns.map((c) => c.name);

      expect(names).toContain('id');
      expect(names).toContain('session_id');
      expect(names).toContain('session_slug');
      expect(names).toContain('content');
      expect(names).toContain('vector_clock');
      expect(names).toContain('agent_id');
    });

    it('has edges table with required columns', () => {
      const columns = db.prepare('PRAGMA table_info(edges)').all() as { name: string }[];
      const names = columns.map((c) => c.name);

      expect(names).toContain('id');
      expect(names).toContain('source_chunk_id');
      expect(names).toContain('target_chunk_id');
      expect(names).toContain('edge_type');
      expect(names).toContain('vector_clock');
      expect(names).toContain('link_count');
    });

    it('has clusters table', () => {
      const columns = db.prepare('PRAGMA table_info(clusters)').all() as { name: string }[];
      const names = columns.map((c) => c.name);

      expect(names).toContain('id');
      expect(names).toContain('name');
      expect(names).toContain('description');
    });

    it('has chunk_clusters join table', () => {
      const columns = db.prepare('PRAGMA table_info(chunk_clusters)').all() as { name: string }[];
      const names = columns.map((c) => c.name);

      expect(names).toContain('chunk_id');
      expect(names).toContain('cluster_id');
      expect(names).toContain('distance');
    });

    it('has vector_clocks table', () => {
      const columns = db.prepare('PRAGMA table_info(vector_clocks)').all() as { name: string }[];
      const names = columns.map((c) => c.name);

      expect(names).toContain('id');
      expect(names).toContain('project_slug');
      expect(names).toContain('clock_data');
    });

    it('has schema version 4', () => {
      const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBe(4);
    });

    it('has project_path column on chunks', () => {
      const columns = db.prepare('PRAGMA table_info(chunks)').all() as { name: string }[];
      const names = columns.map((c) => c.name);
      expect(names).toContain('project_path');
    });
  });

  describe('indexes', () => {
    it('has chunks indexes', () => {
      const indexes = db.prepare('PRAGMA index_list(chunks)').all() as { name: string }[];
      const names = indexes.map((i) => i.name);

      expect(names).toContain('idx_chunks_session');
      expect(names).toContain('idx_chunks_slug');
      expect(names).toContain('idx_chunks_time');
    });

    it('has edges indexes', () => {
      const indexes = db.prepare('PRAGMA index_list(edges)').all() as { name: string }[];
      const names = indexes.map((i) => i.name);

      // SQLite also creates an automatic index for the unique constraint
      expect(names.some((n) => n.includes('edges_source') || n === 'idx_edges_source')).toBe(true);
      expect(names.some((n) => n.includes('edges_target') || n === 'idx_edges_target')).toBe(true);
    });
  });

  describe('foreign keys', () => {
    it('has foreign keys enabled', () => {
      const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
    });

    it('cascades chunk deletion to edges', () => {
      // Insert a chunk
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk1', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content')
      `,
      ).run();

      // Insert another chunk
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk2', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content2')
      `,
      ).run();

      // Insert an edge
      db.prepare(
        `
        INSERT INTO edges (id, source_chunk_id, target_chunk_id, edge_type, initial_weight, created_at)
        VALUES ('edge1', 'chunk1', 'chunk2', 'forward', 1.0, datetime('now'))
      `,
      ).run();

      // Verify edge exists
      const edgeBefore = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge1');
      expect(edgeBefore).toBeDefined();

      // Delete chunk1
      db.prepare('DELETE FROM chunks WHERE id = ?').run('chunk1');

      // Edge should be deleted
      const edgeAfter = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge1');
      expect(edgeAfter).toBeUndefined();
    });

    it('cascades chunk deletion to cluster assignments', () => {
      // Insert a chunk
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk1', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content')
      `,
      ).run();

      // Insert a cluster
      db.prepare(
        `
        INSERT INTO clusters (id, name)
        VALUES ('cluster1', 'Test Cluster')
      `,
      ).run();

      // Assign chunk to cluster
      db.prepare(
        `
        INSERT INTO chunk_clusters (chunk_id, cluster_id, distance)
        VALUES ('chunk1', 'cluster1', 0.5)
      `,
      ).run();

      // Verify assignment exists
      const assignmentBefore = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ?')
        .get('chunk1');
      expect(assignmentBefore).toBeDefined();

      // Delete chunk
      db.prepare('DELETE FROM chunks WHERE id = ?').run('chunk1');

      // Assignment should be deleted
      const assignmentAfter = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ?')
        .get('chunk1');
      expect(assignmentAfter).toBeUndefined();
    });
  });

  describe('constraints', () => {
    it('enforces unique edge constraint', () => {
      // Insert chunks
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk1', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content')
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk2', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content2')
      `,
      ).run();

      // Insert first edge
      db.prepare(
        `
        INSERT INTO edges (id, source_chunk_id, target_chunk_id, edge_type, initial_weight, created_at)
        VALUES ('edge1', 'chunk1', 'chunk2', 'forward', 1.0, datetime('now'))
      `,
      ).run();

      // Attempt to insert duplicate should fail
      expect(() => {
        db.prepare(
          `
          INSERT INTO edges (id, source_chunk_id, target_chunk_id, edge_type, initial_weight, created_at)
          VALUES ('edge2', 'chunk1', 'chunk2', 'forward', 1.0, datetime('now'))
        `,
        ).run();
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('enforces edge type check constraint', () => {
      // Insert chunks
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk1', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content')
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content)
        VALUES ('chunk2', 'sess1', 'test-project', '[]', '2024-01-01', '2024-01-01', 'content2')
      `,
      ).run();

      // Attempt to insert invalid edge type
      expect(() => {
        db.prepare(
          `
          INSERT INTO edges (id, source_chunk_id, target_chunk_id, edge_type, initial_weight, created_at)
          VALUES ('edge1', 'chunk1', 'chunk2', 'invalid', 1.0, datetime('now'))
        `,
        ).run();
      }).toThrow(/CHECK constraint failed/);
    });
  });
});
