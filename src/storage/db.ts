/**
 * SQLite database connection and migrations.
 *
 * Supports optional encryption using better-sqlite3-multiple-ciphers.
 */

import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolvePath } from '../config/memory-config.js';
import { loadConfig } from '../config/loader.js';
import { createSecretStore } from '../utils/secret-store.js';
import { withSecureBufferSync } from '../utils/secure-buffer.js';
import { logAudit } from './audit-log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Key name in secret store for database encryption */
const DB_KEY_NAME = 'ecm-db-key';

let db: Database.Database | null = null;
let customDb: Database.Database | null = null;

/** Cached encryption key (only set when keySource is not 'prompt') */
let cachedDbKey: string | null = null;

/** Service name for keychain storage */
const KEYCHAIN_SERVICE = 'entropic-causal-memory';

/**
 * Get key from OS keychain synchronously.
 * Supports macOS Keychain and Linux secret-tool.
 */
function getKeyFromKeychainSync(): string | null {
  try {
    if (process.platform === 'darwin') {
      // macOS Keychain
      const result = execSync(
        `security find-generic-password -a "${DB_KEY_NAME}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      return result.trim() || null;
    } else if (process.platform === 'linux') {
      // Linux secret-tool
      const result = execSync(
        `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${DB_KEY_NAME}" 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      return result.trim() || null;
    }
    return null;
  } catch {
    // Key not found or keychain not available
    return null;
  }
}

/**
 * Set a custom database instance (for testing).
 *
 * When set, `getDb()` will return this instance instead of creating a new one.
 * Use `resetDb()` to clear the custom instance.
 *
 * @example
 * ```typescript
 * import { setDb, resetDb } from './db.js';
 *
 * beforeEach(() => {
 *   const testDb = new Database(':memory:');
 *   // ... run migrations ...
 *   setDb(testDb);
 * });
 *
 * afterEach(() => {
 *   resetDb();
 * });
 * ```
 */
export function setDb(database: Database.Database): void {
  customDb = database;
}

/**
 * Reset the database to default behavior.
 *
 * Clears any custom database set via `setDb()` and closes the current
 * singleton connection. The next call to `getDb()` will create a new
 * connection.
 */
export function resetDb(): void {
  if (customDb) {
    customDb = null;
  }
  if (db) {
    logAudit('close', 'Database closed');
    db.close();
    db = null;
  }
  cachedDbKey = null;
}

/**
 * Get the database encryption key synchronously.
 * Returns undefined if encryption is disabled or key is not available.
 */
function getDbKeySync(): string | undefined {
  const config = loadConfig();
  if (!config.encryption?.enabled) {
    return undefined;
  }

  // Return cached key if available
  if (cachedDbKey) {
    return cachedDbKey;
  }

  const keySource = config.encryption.keySource ?? 'keychain';

  switch (keySource) {
    case 'env': {
      const key = process.env.ECM_DB_KEY;
      if (key) {
        cachedDbKey = key;
        logAudit('key-access', 'Key retrieved from environment');
      }
      return key;
    }
    case 'keychain': {
      // Try to load from OS keychain synchronously
      const keychainKey = getKeyFromKeychainSync();
      if (keychainKey) {
        cachedDbKey = keychainKey;
        logAudit('key-access', 'Key retrieved from keychain');
        return keychainKey;
      }
      // Fallback to env if keychain key not available
      const envKey = process.env.ECM_DB_KEY;
      if (envKey) {
        cachedDbKey = envKey;
        logAudit('key-access', 'Key retrieved from environment (keychain fallback)');
        return envKey;
      }
      return undefined;
    }
    case 'prompt':
      // Prompt is only available in CLI context, not here
      throw new Error(
        'Database encryption with keySource=prompt requires running ecm init or ecm encryption unlock first'
      );
    default:
      return undefined;
  }
}

/**
 * Get the database encryption key asynchronously.
 * Use this for initial setup or when async is acceptable.
 */
export async function getDbKeyAsync(): Promise<string | undefined> {
  const config = loadConfig();
  if (!config.encryption?.enabled) {
    return undefined;
  }

  const keySource = config.encryption.keySource ?? 'keychain';

  switch (keySource) {
    case 'env': {
      const key = process.env.ECM_DB_KEY;
      if (key) {
        cachedDbKey = key;
        logAudit('key-access', 'Key retrieved from environment');
      }
      return key;
    }
    case 'keychain': {
      const store = createSecretStore();
      const key = await store.get(DB_KEY_NAME);
      if (key) {
        cachedDbKey = key;
        logAudit('key-access', 'Key retrieved from keychain');
      }
      return key ?? undefined;
    }
    case 'prompt':
      // Must be handled by caller
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Set the cached database key.
 * Used by CLI commands that prompt for the key.
 */
export function setDbKey(key: string): void {
  cachedDbKey = key;
}

/**
 * Store the database key in the secret store.
 */
export async function storeDbKey(key: string): Promise<void> {
  const store = createSecretStore();
  await store.set(DB_KEY_NAME, key);
  cachedDbKey = key;
  logAudit('key-access', 'Key stored in keychain');
}

/**
 * Apply encryption to a database connection.
 */
function applyEncryption(database: Database.Database, key: string): void {
  const config = loadConfig();
  const cipher = config.encryption?.cipher ?? 'chacha20';

  withSecureBufferSync(key, (secureKey) => {
    // Set cipher before key
    database.pragma(`cipher = '${cipher}'`);
    database.pragma(`key = '${secureKey.toString()}'`);
  });

  logAudit('open', `Database opened with ${cipher} encryption`);
}

/**
 * Initialize and return the database connection.
 *
 * Returns (in priority order):
 * 1. Custom database set via `setDb()` (for testing)
 * 2. Existing singleton connection
 * 3. New connection to the configured path
 *
 * When encryption is enabled:
 * - Retrieves key from configured source (keychain, env, or cached)
 * - Applies cipher pragma before key pragma
 * - Logs access attempt to audit log if enabled
 */
export function getDb(dbPath?: string): Database.Database {
  // Return custom database if set (for testing)
  if (customDb) {
    return customDb;
  }

  if (db) {
    return db;
  }

  const config = loadConfig();
  const resolvedPath = resolvePath(dbPath ?? config.storage?.dbPath ?? '~/.ecm/memory.db');

  // Ensure directory exists
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);

  // Apply encryption if configured
  if (config.encryption?.enabled) {
    const key = getDbKeySync();
    if (key) {
      applyEncryption(db, key);
    } else {
      logAudit('failed', 'No encryption key available');
      throw new Error(
        'Database encryption is enabled but no key is available. ' +
        'Run "ecm encryption setup" or set ECM_DB_KEY environment variable.'
      );
    }
  } else {
    logAudit('open', 'Database opened (unencrypted)');
  }

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
