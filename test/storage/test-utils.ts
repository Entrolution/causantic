/**
 * Test utilities for storage layer tests.
 * Provides in-memory database setup that matches production schema.
 *
 * ## Usage with DI
 *
 * For integration tests that need to use actual store modules:
 *
 * ```typescript
 * import { beforeEach, afterEach } from 'vitest';
 * import { createTestDb, setupTestDb, teardownTestDb } from './test-utils.js';
 *
 * let db: Database.Database;
 *
 * beforeEach(() => {
 *   db = createTestDb();
 *   setupTestDb(db);  // Sets db for all store modules
 * });
 *
 * afterEach(() => {
 *   teardownTestDb(db);  // Closes db and resets singleton
 * });
 * ```
 */

import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';

/**
 * Create an in-memory SQLite database with the full Causantic schema.
 * This matches the production schema without relying on file-based migrations.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Create full schema
  db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    -- Chunks table
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
      spawn_depth INTEGER DEFAULT 0,
      project_path TEXT,
      team_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_slug ON chunks(session_slug);
    CREATE INDEX IF NOT EXISTS idx_chunks_time ON chunks(start_time);
    CREATE INDEX IF NOT EXISTS idx_chunks_slug_start_time ON chunks(session_slug, start_time);
    CREATE INDEX IF NOT EXISTS idx_chunks_agent_id ON chunks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_team_name ON chunks(team_name);
    CREATE INDEX IF NOT EXISTS idx_chunks_agent_start ON chunks(agent_id, start_time);
    CREATE INDEX IF NOT EXISTS idx_chunks_team_start ON chunks(team_name, start_time);

    -- Edges table
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      target_chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL CHECK(edge_type IN ('backward', 'forward')),
      reference_type TEXT,
      initial_weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      link_count INTEGER DEFAULT 1,
      UNIQUE(source_chunk_id, target_chunk_id, edge_type)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_chunk_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_chunk_id);
    CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges(source_chunk_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges(target_chunk_id, edge_type);

    -- Clusters table
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

    -- Chunk-cluster assignments
    CREATE TABLE IF NOT EXISTS chunk_clusters (
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      distance REAL NOT NULL,
      PRIMARY KEY (chunk_id, cluster_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_clusters_cluster ON chunk_clusters(cluster_id);

    -- Set schema version
    INSERT OR REPLACE INTO schema_version (version) VALUES (10);
  `);

  // Create FTS5 table and sync triggers (separate exec for virtual table)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content='chunks',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF content ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
  } catch {
    // FTS5 may not be available in all SQLite builds
  }

  return db;
}

/**
 * Sample chunk data for testing.
 */
export function createSampleChunk(
  overrides: Partial<{
    id: string;
    sessionId: string;
    sessionSlug: string;
    content: string;
    startTime: string;
    endTime: string;
    turnIndices: number[];
    codeBlockCount: number;
    toolUseCount: number;
    approxTokens: number;
    agentId: string | null;
    spawnDepth: number;
    projectPath: string | null;
    teamName: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? `chunk-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: overrides.sessionId ?? 'test-session-id',
    sessionSlug: overrides.sessionSlug ?? 'test-project',
    content: overrides.content ?? 'Test chunk content',
    startTime: overrides.startTime ?? '2024-01-01T00:00:00Z',
    endTime: overrides.endTime ?? '2024-01-01T00:01:00Z',
    turnIndices: overrides.turnIndices ?? [0, 1],
    codeBlockCount: overrides.codeBlockCount ?? 0,
    toolUseCount: overrides.toolUseCount ?? 0,
    approxTokens: overrides.approxTokens ?? 100,
    agentId: overrides.agentId ?? null,
    spawnDepth: overrides.spawnDepth ?? 0,
    projectPath: overrides.projectPath ?? null,
    teamName: overrides.teamName ?? null,
  };
}

/**
 * Insert a chunk directly into the test database.
 */
export function insertTestChunk(
  db: Database.Database,
  chunk: ReturnType<typeof createSampleChunk>,
): string {
  const stmt = db.prepare(`
    INSERT INTO chunks (
      id, session_id, session_slug, turn_indices, start_time, end_time,
      content, code_block_count, tool_use_count, approx_tokens,
      agent_id, spawn_depth, project_path, team_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    chunk.id,
    chunk.sessionId,
    chunk.sessionSlug,
    JSON.stringify(chunk.turnIndices),
    chunk.startTime,
    chunk.endTime,
    chunk.content,
    chunk.codeBlockCount,
    chunk.toolUseCount,
    chunk.approxTokens,
    chunk.agentId,
    chunk.spawnDepth,
    chunk.projectPath,
    chunk.teamName,
  );

  return chunk.id;
}

/**
 * Insert an edge directly into the test database.
 */
export function insertTestEdge(
  db: Database.Database,
  edge: {
    id: string;
    sourceChunkId: string;
    targetChunkId: string;
    edgeType: 'forward' | 'backward';
    referenceType?: string | null;
    initialWeight?: number;
    linkCount?: number;
  },
): string {
  const stmt = db.prepare(`
    INSERT INTO edges (id, source_chunk_id, target_chunk_id, edge_type, reference_type, initial_weight, created_at, link_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    edge.id,
    edge.sourceChunkId,
    edge.targetChunkId,
    edge.edgeType,
    edge.referenceType ?? null,
    edge.initialWeight ?? 1.0,
    new Date().toISOString(),
    edge.linkCount ?? 1,
  );

  return edge.id;
}

/**
 * Insert a cluster directly into the test database.
 */
export function insertTestCluster(
  db: Database.Database,
  cluster: {
    id: string;
    name?: string | null;
    description?: string | null;
    exemplarIds?: string[];
  },
): string {
  const stmt = db.prepare(`
    INSERT INTO clusters (id, name, description, exemplar_ids)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(
    cluster.id,
    cluster.name ?? null,
    cluster.description ?? null,
    cluster.exemplarIds ? JSON.stringify(cluster.exemplarIds) : null,
  );

  return cluster.id;
}

/**
 * Assign a chunk to a cluster in the test database.
 */
export function assignChunkToCluster(
  db: Database.Database,
  chunkId: string,
  clusterId: string,
  distance: number = 0.5,
): void {
  const stmt = db.prepare(`
    INSERT INTO chunk_clusters (chunk_id, cluster_id, distance)
    VALUES (?, ?, ?)
  `);
  stmt.run(chunkId, clusterId, distance);
}

// ─────────────────────────────────────────────────────────────────────────────
// DI Helpers for Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up a test database for use with store modules.
 *
 * Injects the database into the global singleton, so that all store
 * modules (chunk-store, edge-store, etc.) will use this database.
 *
 * @param db - In-memory database created with `createTestDb()`
 */
export function setupTestDb(db: Database.Database): void {
  setDb(db);
}

/**
 * Tear down the test database.
 *
 * Closes the database and resets the singleton so subsequent tests
 * get a fresh state.
 *
 * @param db - Database to close
 */
export function teardownTestDb(db: Database.Database): void {
  db.close();
  resetDb();
}
