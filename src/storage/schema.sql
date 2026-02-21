-- Causantic Memory System Schema
-- SQLite database for storing chunks, edges, and clusters

-- Core entities: conversation chunks
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_slug TEXT NOT NULL,
  turn_indices TEXT NOT NULL,  -- JSON array of turn indices
  start_time TEXT NOT NULL,    -- ISO timestamp
  end_time TEXT NOT NULL,      -- ISO timestamp
  content TEXT NOT NULL,       -- Full chunk text
  code_block_count INTEGER DEFAULT 0,
  tool_use_count INTEGER DEFAULT 0,
  approx_tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  agent_id TEXT,               -- Agent that created this chunk (null = main UI agent)
  spawn_depth INTEGER DEFAULT 0, -- Nesting level: 0=main, 1=sub-agent, 2=sub-sub-agent
  project_path TEXT,             -- Full cwd path for disambiguation
  team_name TEXT                 -- Team name for agent team sessions (null for non-team)
);

-- Clusters for topic grouping
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  name TEXT,                    -- Short cluster name
  description TEXT,             -- LLM-generated description
  centroid BLOB,                -- Float32Array serialized
  exemplar_ids TEXT,            -- JSON array of exemplar chunk IDs
  membership_hash TEXT,         -- For staleness detection
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  refreshed_at TEXT             -- When description was last updated
);

-- Edges (sequential linked-list, forward-only)
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_chunk_id TEXT NOT NULL,
  target_chunk_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,      -- 'forward' (direction inferred at query time)
  reference_type TEXT,          -- 'within-chain', 'cross-session', 'brief', 'debrief'
  initial_weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  link_count INTEGER DEFAULT 1,
  FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (target_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- Chunk-cluster membership (many-to-many)
CREATE TABLE IF NOT EXISTS chunk_clusters (
  chunk_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  distance REAL NOT NULL,       -- Angular distance to centroid
  PRIMARY KEY (chunk_id, cluster_id),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

-- Indices for efficient querying
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_session_slug ON chunks(session_slug);
CREATE INDEX IF NOT EXISTS idx_chunks_start_time ON chunks(start_time);
CREATE INDEX IF NOT EXISTS idx_chunks_slug_start_time ON chunks(session_slug, start_time);
CREATE INDEX IF NOT EXISTS idx_chunks_agent_id ON chunks(agent_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_chunk_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges(source_chunk_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges(target_chunk_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_chunk_clusters_cluster ON chunk_clusters(cluster_id);

-- Ingestion checkpoints for incremental ingestion
CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  session_id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  last_turn_index INTEGER NOT NULL,
  last_chunk_id TEXT,
  file_mtime TEXT,              -- ISO timestamp of file mtime at last ingest
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_project ON ingestion_checkpoints(project_slug);

-- Embedding cache for content-hash based caching
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  hit_count INTEGER DEFAULT 0,
  PRIMARY KEY (content_hash, model_id)
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model_id);

-- Schema version for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search index (content-sync mode, porter stemming)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Keep FTS in sync with chunks table
CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF content ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Insert initial version if not exists (v9 adds team_name column and agent_id index)
INSERT OR IGNORE INTO schema_version (version) VALUES (9);
