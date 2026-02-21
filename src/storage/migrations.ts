/**
 * Database migrations for schema evolution.
 *
 * Extracted from db.ts for clarity. Each migration function handles
 * upgrading from one schema version to the next.
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { loadSchemaStatements } from './schema-loader.js';

/**
 * Run all pending migrations on the database.
 */
export function runMigrations(database: Database.Database): void {
  // Get current schema version (0 if schema_version table doesn't exist)
  let currentVersion = 0;
  try {
    const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as
      | { version: number }
      | undefined;
    currentVersion = row?.version ?? 0;
  } catch {
    // Table doesn't exist yet, version is 0
  }

  // Read and execute schema for fresh databases
  const statements = loadSchemaStatements();

  for (const statement of statements) {
    try {
      database.exec(statement);
    } catch (error) {
      // Ignore "table already exists" errors for CREATE TABLE IF NOT EXISTS
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists')) {
        throw error;
      }
    }
  }

  // Run incremental migrations for existing databases
  if (currentVersion < 2) {
    migrateToV2(database);
  }
  if (currentVersion < 3) {
    migrateToV3(database);
  }
  if (currentVersion < 4) {
    migrateToV4(database);
  }
  if (currentVersion < 5) {
    migrateToV5(database);
  }
  if (currentVersion < 6) {
    migrateToV6(database);
  }
  if (currentVersion < 7) {
    migrateToV7(database);
  }
  if (currentVersion < 8) {
    migrateToV8(database);
  }
  if (currentVersion < 9) {
    migrateToV9(database);
  }
}

/**
 * Migrate from v1 to v2 (add vector clock support).
 */
function migrateToV2(database: Database.Database): void {
  const chunkColumns = [
    { name: 'agent_id', type: 'TEXT' },
    { name: 'vector_clock', type: 'TEXT' },
    { name: 'spawn_depth', type: 'INTEGER DEFAULT 0' },
  ];

  for (const col of chunkColumns) {
    try {
      database.exec(`ALTER TABLE chunks ADD COLUMN ${col.name} ${col.type}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column')) {
        throw error;
      }
    }
  }

  const edgeColumns = [
    { name: 'vector_clock', type: 'TEXT' },
    { name: 'link_count', type: 'INTEGER DEFAULT 1' },
  ];

  for (const col of edgeColumns) {
    try {
      database.exec(`ALTER TABLE edges ADD COLUMN ${col.name} ${col.type}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column')) {
        throw error;
      }
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS vector_clocks (
      id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      clock_data TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_vector_clocks_project ON vector_clocks(project_slug)
  `);

  database.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (2)`);
}

/**
 * Migrate from v2 to v3 (add ingestion checkpoints and embedding cache).
 */
function migrateToV3(database: Database.Database): void {
  database.exec(`
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

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_project ON ingestion_checkpoints(project_slug)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      content_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      hit_count INTEGER DEFAULT 0,
      PRIMARY KEY (content_hash, model_id)
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model_id)
  `);

  database.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (3)`);
}

/**
 * Migrate from v3 to v4 (add project labels and project_path).
 */
function migrateToV4(database: Database.Database): void {
  try {
    database.exec('ALTER TABLE chunks ADD COLUMN project_path TEXT');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('duplicate column')) {
      throw error;
    }
  }

  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  const sessionProjectMap = new Map<string, { slug: string; cwd: string }>();

  if (existsSync(claudeProjectsDir)) {
    const slugToCwds = new Map<string, Set<string>>();

    try {
      const projectDirs = readdirSync(claudeProjectsDir, { withFileTypes: true });

      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;

        const projectDir = join(claudeProjectsDir, dir.name);
        const files = readdirSync(projectDir, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;

          const filePath = join(projectDir, file.name);
          const info = extractSessionInfoFromFile(filePath);
          if (!info) continue;

          const slug = info.cwd ? basename(info.cwd) : '';
          if (slug && info.cwd) {
            const cwds = slugToCwds.get(slug) ?? new Set();
            cwds.add(info.cwd);
            slugToCwds.set(slug, cwds);
          }

          sessionProjectMap.set(info.sessionId, { slug, cwd: info.cwd });
        }
      }
    } catch {
      // Can't read projects dir — continue without backfill
    }

    const collisionSlugs = new Set<string>();
    for (const [slug, cwds] of slugToCwds) {
      if (cwds.size > 1) {
        collisionSlugs.add(slug);
      }
    }

    if (collisionSlugs.size > 0) {
      for (const [sessionId, info] of sessionProjectMap) {
        if (collisionSlugs.has(info.slug) && info.cwd) {
          const parts = info.cwd.split('/').filter(Boolean);
          if (parts.length >= 2) {
            info.slug = parts.slice(-2).join('/');
          }
          sessionProjectMap.set(sessionId, info);
        }
      }
    }
  }

  const updateChunk = database.prepare(
    "UPDATE chunks SET session_slug = ?, project_path = ? WHERE session_id = ? AND (session_slug = '' OR session_slug IS NULL OR project_path IS NULL)",
  );

  const backfillChunks = database.transaction(() => {
    for (const [sessionId, info] of sessionProjectMap) {
      if (info.slug) {
        updateChunk.run(info.slug, info.cwd, sessionId);
      }
    }
  });
  backfillChunks();

  const updateCheckpoint = database.prepare(
    "UPDATE ingestion_checkpoints SET project_slug = ? WHERE session_id = ? AND (project_slug = '' OR project_slug IS NULL)",
  );

  const backfillCheckpoints = database.transaction(() => {
    for (const [sessionId, info] of sessionProjectMap) {
      if (info.slug) {
        updateCheckpoint.run(info.slug, sessionId);
      }
    }
  });
  backfillCheckpoints();

  try {
    const emptyClockRows = database
      .prepare("SELECT id, clock_data FROM vector_clocks WHERE project_slug = ''")
      .all() as Array<{ id: string; clock_data: string }>;

    if (emptyClockRows.length > 0) {
      const distinctSlugs = database
        .prepare("SELECT DISTINCT session_slug FROM chunks WHERE session_slug != ''")
        .all() as Array<{ session_slug: string }>;

      const insertClock = database.prepare(
        'INSERT OR REPLACE INTO vector_clocks (id, project_slug, clock_data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      );

      const rekeyClocks = database.transaction(() => {
        for (const emptyRow of emptyClockRows) {
          for (const { session_slug } of distinctSlugs) {
            const parts = emptyRow.id.split(':');
            let newId: string;
            if (parts[0] === 'project') {
              newId = `project:${session_slug}`;
            } else if (parts[0] === 'agent') {
              const agentId = parts.slice(2).join(':');
              newId = `agent:${session_slug}:${agentId}`;
            } else {
              continue;
            }

            insertClock.run(newId, session_slug, emptyRow.clock_data);
          }
        }

        database.prepare("DELETE FROM vector_clocks WHERE project_slug = ''").run();
      });
      rekeyClocks();
    }
  } catch {
    // vector_clocks table may not exist yet in some edge cases
  }

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (4)');
}

/**
 * Migrate from v4 to v5 (add FTS5 full-text search).
 */
function migrateToV5(database: Database.Database): void {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content='chunks',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already exists')) {
      // Table exists, continue
    } else {
      database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (5)');
      return;
    }
  }

  try {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF content ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);
  } catch {
    // Triggers may already exist
  }

  try {
    database.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
  } catch {
    // Rebuild may fail if table has issues — not critical
  }

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (5)');
}

/**
 * Migrate from v5 to v6 (add composite index for session reconstruction).
 */
function migrateToV6(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_slug_start_time ON chunks(session_slug, start_time)
  `);

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (6)');
}

/**
 * Migrate from v6 to v7 (remove vector clock columns and table).
 */
function migrateToV7(database: Database.Database): void {
  // Drop vector_clock column from chunks
  try {
    database.exec('ALTER TABLE chunks DROP COLUMN vector_clock');
  } catch {
    // Column may not exist
  }

  // Drop vector_clock column from edges
  try {
    database.exec('ALTER TABLE edges DROP COLUMN vector_clock');
  } catch {
    // Column may not exist
  }

  // Drop vector_clock column from ingestion_checkpoints
  try {
    database.exec('ALTER TABLE ingestion_checkpoints DROP COLUMN vector_clock');
  } catch {
    // Column may not exist
  }

  // Drop vector_clocks table and its index
  database.exec('DROP INDEX IF EXISTS idx_vector_clocks_project');
  database.exec('DROP TABLE IF EXISTS vector_clocks');

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (7)');
}

/**
 * Migrate from v7 to v8 (add chain-walking indices for episodic retrieval).
 */
function migrateToV8(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges(source_chunk_id, edge_type)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges(target_chunk_id, edge_type)
  `);

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (8)');
}

/**
 * Migrate from v8 to v9 (add team_name column and agent_id index for agent teams).
 */
function migrateToV9(database: Database.Database): void {
  try {
    database.exec('ALTER TABLE chunks ADD COLUMN team_name TEXT');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('duplicate column')) {
      throw error;
    }
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_agent_id ON chunks(agent_id)
  `);

  database.exec('INSERT OR REPLACE INTO schema_version (version) VALUES (9)');
}

/**
 * Extract sessionId and cwd from first few lines of a JSONL file.
 */
function extractSessionInfoFromFile(filePath: string): { sessionId: string; cwd: string } | null {
  try {
    const content = readFileSync(filePath, { encoding: 'utf-8' });
    const lines = content.split('\n');
    const limit = Math.min(lines.length, 10);

    let sessionId = '';
    let cwd = '';

    for (let i = 0; i < limit; i++) {
      if (!lines[i].trim()) continue;
      try {
        const parsed = JSON.parse(lines[i]);
        if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId;
        if (!cwd && parsed.cwd) cwd = parsed.cwd;
        if (sessionId && cwd) break;
      } catch {
        continue;
      }
    }

    if (!sessionId) return null;
    return { sessionId, cwd };
  } catch {
    return null;
  }
}
