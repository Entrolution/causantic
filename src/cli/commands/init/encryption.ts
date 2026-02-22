import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, storeDbKey } from '../../../storage/db.js';
import { promptYesNo } from '../../utils.js';

export async function setupEncryption(causanticDir: string): Promise<boolean> {
  const dbPath = path.join(causanticDir, 'memory.db');
  const existingDbExists = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;

  let existingDbIsUnencrypted = false;
  if (existingDbExists) {
    try {
      const Database = (await import('better-sqlite3-multiple-ciphers')).default;
      const testDb = new Database(dbPath);
      testDb.prepare('SELECT 1').get();
      testDb.close();
      existingDbIsUnencrypted = true;
    } catch {
      // DB exists but can't be opened without key — may already be encrypted
    }
  }

  console.log('');
  console.log('Enable database encryption?');
  console.log('Protects conversation data, embeddings, and work patterns.');

  if (existingDbIsUnencrypted) {
    console.log('');
    console.log('\u26a0  Existing unencrypted database detected.');
    console.log(
      '  Enabling encryption will back up the existing database and create a new encrypted one.',
    );
    console.log('  Your data will be migrated automatically.');
  }

  if (!(await promptYesNo('Enable encryption?'))) return false;

  const { generatePassword } = await import('../../../storage/encryption.js');

  if (existingDbIsUnencrypted) {
    const backupPath = dbPath + '.unencrypted.bak';
    fs.copyFileSync(dbPath, backupPath);
    console.log(`\u2713 Backed up existing database to ${path.basename(backupPath)}`);
    fs.unlinkSync(dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    }
  }

  console.log('');
  console.log('Generating encryption key...');

  const key = generatePassword(32);
  await storeDbKey(key);

  const configPath = path.join(causanticDir, 'config.json');
  const existingConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...existingConfig,
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain' },
      },
      null,
      2,
    ),
  );

  console.log('\u2713 Key stored in system keychain');
  console.log('\u2713 Encryption enabled with ChaCha20-Poly1305');

  if (existingDbIsUnencrypted) {
    await migrateToEncryptedDb(dbPath);
  }

  return true;
}

async function migrateToEncryptedDb(dbPath: string): Promise<void> {
  const backupPath = dbPath + '.unencrypted.bak';
  try {
    const newDb = getDb();
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const oldDb = new Database(backupPath);

    // Skip schema_version (handled by migrations) and FTS5 shadow tables
    // (populated automatically via triggers when chunks are inserted)
    const tables = oldDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version' AND name NOT LIKE 'chunks_fts%'",
      )
      .all() as Array<{ name: string }>;

    let migratedRows = 0;
    for (const { name } of tables) {
      const exists = newDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name);
      if (!exists) continue;

      const rows = oldDb.prepare(`SELECT * FROM "${name}"`).all();
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = columns.map(() => '?').join(', ');
      const insert = newDb.prepare(
        `INSERT OR IGNORE INTO "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
      );

      const batchInsert = newDb.transaction((rowBatch: Array<Record<string, unknown>>) => {
        for (const row of rowBatch) {
          insert.run(...columns.map((c) => row[c]));
        }
      });
      batchInsert(rows as Array<Record<string, unknown>>);
      migratedRows += rows.length;
    }

    oldDb.close();
    console.log(`\u2713 Migrated ${migratedRows} rows to encrypted database`);
  } catch (err) {
    console.log(`\u26a0 Migration error: ${(err as Error).message}`);
    console.log(`  Backup preserved at: ${backupPath}`);
    console.log('  You can manually re-import with: causantic import');
  }
}
