/**
 * SQLite database connection management.
 *
 * Supports optional encryption using better-sqlite3-multiple-ciphers.
 * Schema loading and migrations are handled by schema-loader.ts and migrations.ts.
 */

import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync, mkdirSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { dirname } from 'path';
import { resolvePath } from '../config/memory-config.js';
import { loadConfig } from '../config/loader.js';
import { createSecretStore } from '../utils/secret-store.js';
import { withSecureBufferSync } from '../utils/secure-buffer.js';
import { logAudit } from './audit-log.js';
import { runMigrations } from './migrations.js';

/** Key name in secret store for database encryption */
const DB_KEY_NAME = 'causantic-db-key';

let db: Database.Database | null = null;
let customDb: Database.Database | null = null;

/** Cached encryption key (only set when keySource is not 'prompt') */
let cachedDbKey: string | null = null;

/** Service name for keychain storage */
const KEYCHAIN_SERVICE = 'causantic';

/**
 * Get key from OS keychain synchronously.
 * Supports macOS Keychain and Linux secret-tool.
 */
function getKeyFromKeychainSync(): string | null {
  try {
    if (process.platform === 'darwin') {
      const result = execFileSync(
        'security',
        ['find-generic-password', '-a', DB_KEY_NAME, '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      );
      return result.trim() || null;
    } else if (process.platform === 'linux') {
      const result = spawnSync(
        'secret-tool',
        ['lookup', 'service', KEYCHAIN_SERVICE, 'account', DB_KEY_NAME],
        { encoding: 'utf-8' },
      );
      return (result.status === 0 && result.stdout?.trim()) || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Set a custom database instance (for testing).
 */
export function setDb(database: Database.Database): void {
  customDb = database;
}

/**
 * Reset the database to default behavior.
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
 */
function getDbKeySync(): string | undefined {
  const config = loadConfig();
  if (!config.encryption?.enabled) {
    return undefined;
  }

  if (cachedDbKey) {
    return cachedDbKey;
  }

  const keySource = config.encryption.keySource ?? 'keychain';

  switch (keySource) {
    case 'env': {
      const key = process.env.CAUSANTIC_DB_KEY;
      if (key) {
        cachedDbKey = key;
        logAudit('key-access', 'Key retrieved from environment');
      }
      return key;
    }
    case 'keychain': {
      const keychainKey = getKeyFromKeychainSync();
      if (keychainKey) {
        cachedDbKey = keychainKey;
        logAudit('key-access', 'Key retrieved from keychain');
        return keychainKey;
      }
      const envKey = process.env.CAUSANTIC_DB_KEY;
      if (envKey) {
        cachedDbKey = envKey;
        logAudit('key-access', 'Key retrieved from environment (keychain fallback)');
        return envKey;
      }
      return undefined;
    }
    case 'prompt':
      throw new Error(
        'Database encryption with keySource=prompt requires running causantic init or causantic encryption unlock first',
      );
    default:
      return undefined;
  }
}

/**
 * Get the database encryption key asynchronously.
 */
export async function getDbKeyAsync(): Promise<string | undefined> {
  const config = loadConfig();
  if (!config.encryption?.enabled) {
    return undefined;
  }

  const keySource = config.encryption.keySource ?? 'keychain';

  switch (keySource) {
    case 'env': {
      const key = process.env.CAUSANTIC_DB_KEY;
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
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Set the cached database key.
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
    database.pragma(`cipher = '${cipher}'`);
    database.pragma(`key = '${secureKey.toString()}'`);
  });

  logAudit('open', `Database opened with ${cipher} encryption`);
}

/**
 * Initialize and return the database connection.
 */
export function getDb(dbPath?: string): Database.Database {
  if (customDb) {
    return customDb;
  }

  if (db) {
    return db;
  }

  const config = loadConfig();
  const resolvedPath = resolvePath(dbPath ?? config.storage?.dbPath ?? '~/.causantic/memory.db');

  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);

  if (config.encryption?.enabled) {
    const key = getDbKeySync();
    if (key) {
      applyEncryption(db, key);
    } else {
      logAudit('failed', 'No encryption key available');
      throw new Error(
        'Database encryption is enabled but no key is available. ' +
          'Run "causantic encryption setup" or set CAUSANTIC_DB_KEY environment variable.',
      );
    }
  } else {
    logAudit('open', 'Database opened (unencrypted)');
  }

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

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
export function getDbStats(database?: Database.Database): {
  chunks: number;
  edges: number;
  clusters: number;
  assignments: number;
} {
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
