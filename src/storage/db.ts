/**
 * SQLite database connection and migrations.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolvePath } from '../config/memory-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

/**
 * Initialize and return the database connection.
 */
export function getDb(dbPath?: string): Database.Database {
  if (db) {
    return db;
  }

  const resolvedPath = resolvePath(dbPath ?? '~/.semansiation/memory.db');

  // Ensure directory exists
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run database migrations.
 */
function runMigrations(database: Database.Database): void {
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
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Split by statement (split on semicolons at line ends)
  const statements = schema
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .map((s) => {
      // Remove leading comment lines from each statement
      const lines = s.split('\n');
      while (lines.length > 0 && lines[0].trim().startsWith('--')) {
        lines.shift();
      }
      return lines.join('\n').trim();
    })
    .filter((s) => s.length > 0);

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
}

/**
 * Migrate from v1 to v2 (add vector clock support).
 */
function migrateToV2(database: Database.Database): void {
  // Add new columns to chunks table (SQLite requires separate ALTER statements)
  const chunkColumns = [
    { name: 'agent_id', type: 'TEXT' },
    { name: 'vector_clock', type: 'TEXT' },
    { name: 'spawn_depth', type: 'INTEGER DEFAULT 0' },
  ];

  for (const col of chunkColumns) {
    try {
      database.exec(`ALTER TABLE chunks ADD COLUMN ${col.name} ${col.type}`);
    } catch (error) {
      // Ignore if column already exists
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column')) {
        throw error;
      }
    }
  }

  // Add new columns to edges table
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

  // Create vector_clocks table
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

  // Update schema version
  database.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (2)`);
}

/**
 * Get current schema version.
 */
export function getSchemaVersion(database?: Database.Database): number {
  const d = database ?? getDb();
  const row = d.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

/**
 * Clear all data (for testing).
 */
export function clearAllData(database?: Database.Database): void {
  const d = database ?? getDb();
  d.exec('DELETE FROM chunk_clusters');
  d.exec('DELETE FROM edges');
  d.exec('DELETE FROM chunks');
  d.exec('DELETE FROM clusters');
}

/**
 * Get database statistics.
 */
export function getDbStats(
  database?: Database.Database
): { chunks: number; edges: number; clusters: number; assignments: number } {
  const d = database ?? getDb();

  const chunks = (d.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number })
    .count;
  const edges = (d.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }).count;
  const clusters = (d.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number })
    .count;
  const assignments = (
    d.prepare('SELECT COUNT(*) as count FROM chunk_clusters').get() as { count: number }
  ).count;

  return { chunks, edges, clusters, assignments };
}

/**
 * Generate a unique ID.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
