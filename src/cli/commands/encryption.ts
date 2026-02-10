import type { Command } from '../types.js';
import { loadConfig } from '../../config/loader.js';
import { promptPassword } from '../utils.js';

export const encryptionCommand: Command = {
  name: 'encryption',
  description: 'Manage database encryption',
  usage: 'ecm encryption <setup|status|rotate-key|backup-key|restore-key|audit>',
  handler: async (args) => {
    const subcommand = args[0];
    const config = loadConfig();

    switch (subcommand) {
      case 'setup': {
        const { generatePassword } = await import('../../storage/encryption.js');
        const { storeDbKey } = await import('../../storage/db.js');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');

        // Check for existing unencrypted database
        const dbPath = path.join(os.homedir(), '.ecm', 'memory.db');
        if (fs.existsSync(dbPath)) {
          const header = Buffer.alloc(16);
          const fd = fs.openSync(dbPath, 'r');
          fs.readSync(fd, header, 0, 16, 0);
          fs.closeSync(fd);

          const sqliteHeader = 'SQLite format 3';
          if (header.toString('utf-8', 0, 15) === sqliteHeader) {
            console.error('Warning: Existing unencrypted database detected!');
            console.error('');
            console.error('The database at ~/.ecm/memory.db is not encrypted.');
            console.error('Enabling encryption will make it unreadable.');
            console.error('');
            console.error('Options:');
            console.error('  1. Export data first:');
            console.error('     npx ecm export --output backup.json --no-encrypt');
            console.error('     rm ~/.ecm/memory.db');
            console.error('     npx ecm encryption setup');
            console.error('     npx ecm init');
            console.error('     npx ecm import backup.json');
            console.error('');
            console.error('  2. Start fresh (lose existing data):');
            console.error('     rm ~/.ecm/memory.db');
            console.error('     npx ecm encryption setup');
            console.error('');
            process.exit(1);
          }
        }

        console.log('Setting up database encryption...');
        console.log('');

        const key = generatePassword(32);
        await storeDbKey(key);
        console.log('\u2713 Encryption key stored in system keychain');

        const configPath = path.join(os.homedir(), '.ecm', 'config.json');
        let existingConfig: Record<string, unknown> = {};

        if (fs.existsSync(configPath)) {
          try {
            existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          } catch {
            // Start fresh
          }
        }

        existingConfig.encryption = {
          enabled: true,
          cipher: 'chacha20',
          keySource: 'keychain',
        };

        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
        console.log('\u2713 Updated ~/.ecm/config.json');

        console.log('');
        console.log('Encryption enabled with ChaCha20-Poly1305.');
        console.log('');
        console.log('IMPORTANT: Back up your encryption key:');
        console.log('  npx ecm encryption backup-key ~/ecm-key-backup.enc');
        console.log('');
        console.log('If you lose the key, your data cannot be recovered.');
        break;
      }

      case 'status': {
        const enabled = config.encryption?.enabled ?? false;
        const cipher = config.encryption?.cipher ?? 'chacha20';
        const keySource = config.encryption?.keySource ?? 'keychain';
        const auditLog = config.encryption?.auditLog ?? false;

        console.log('Database Encryption Status:');
        console.log(`  Enabled: ${enabled ? 'yes' : 'no'}`);
        if (enabled) {
          console.log(`  Cipher: ${cipher}`);
          console.log(`  Key source: ${keySource}`);
          console.log(`  Audit logging: ${auditLog ? 'yes' : 'no'}`);
        }
        break;
      }

      case 'rotate-key': {
        if (!config.encryption?.enabled) {
          console.error('Error: Encryption is not enabled.');
          console.log('Run "ecm encryption setup" first.');
          process.exit(1);
        }

        const { getDbKeyAsync, storeDbKey, getDb } = await import('../../storage/db.js');
        const { generatePassword } = await import('../../storage/encryption.js');
        const { logAudit } = await import('../../storage/audit-log.js');

        const currentKey = await getDbKeyAsync();
        if (!currentKey) {
          console.error('Error: Could not retrieve current encryption key.');
          process.exit(1);
        }

        console.log('Rotating database encryption key...');
        console.log('');

        const newKey = generatePassword(32);

        try {
          const db = getDb();
          db.pragma(`rekey = '${newKey}'`);
          await storeDbKey(newKey);
          logAudit('key-rotate', 'Encryption key rotated');
          console.log('\u2713 Encryption key rotated successfully');
          console.log('');
          console.log('Remember to update your key backup:');
          console.log('  npx ecm encryption backup-key ~/ecm-key-backup.enc');
        } catch (error) {
          console.error(`Error rotating key: ${(error as Error).message}`);
          process.exit(1);
        }
        break;
      }

      case 'backup-key': {
        const outputPath = args[1] ?? 'ecm-key-backup.enc';
        const { getDbKeyAsync } = await import('../../storage/db.js');
        const { encryptString } = await import('../../storage/encryption.js');
        const fs = await import('node:fs');

        const key = await getDbKeyAsync();
        if (!key) {
          console.error('Error: No encryption key found.');
          console.log('Run "ecm encryption setup" first.');
          process.exit(1);
        }

        const backupPassword = await promptPassword('Enter backup password: ');
        if (!backupPassword) {
          console.error('Error: Backup password required.');
          process.exit(2);
        }
        const confirm = await promptPassword('Confirm backup password: ');
        if (backupPassword !== confirm) {
          console.error('Error: Passwords do not match.');
          process.exit(2);
        }

        const encryptedKey = encryptString(key, backupPassword);
        fs.writeFileSync(outputPath, encryptedKey);

        console.log(`\u2713 Key backed up to: ${outputPath}`);
        console.log('');
        console.log('Store this file securely. You will need the backup password to restore.');
        break;
      }

      case 'restore-key': {
        const inputPath = args[1];
        if (!inputPath) {
          console.error('Error: Backup file path required');
          console.log('Usage: ecm encryption restore-key <backup-file>');
          process.exit(2);
        }

        const fs = await import('node:fs');
        const { decryptString } = await import('../../storage/encryption.js');
        const { storeDbKey } = await import('../../storage/db.js');

        if (!fs.existsSync(inputPath)) {
          console.error(`Error: File not found: ${inputPath}`);
          process.exit(1);
        }

        const encryptedKey = fs.readFileSync(inputPath, 'utf-8');
        const backupPassword = await promptPassword('Enter backup password: ');

        try {
          const key = decryptString(encryptedKey, backupPassword);
          await storeDbKey(key);
          console.log('\u2713 Key restored successfully');
        } catch {
          console.error('Error: Failed to decrypt. Wrong password?');
          process.exit(1);
        }
        break;
      }

      case 'audit': {
        const { readAuditLog, formatAuditEntries } = await import('../../storage/audit-log.js');
        const limit = args[1] ? parseInt(args[1], 10) : 10;

        const entries = readAuditLog(limit);
        if (entries.length === 0) {
          console.log('No audit entries found.');
          console.log('');
          console.log('To enable audit logging, add to config:');
          console.log('  { "encryption": { "auditLog": true } }');
        } else {
          console.log(`Last ${entries.length} audit entries:`);
          console.log('');
          console.log(formatAuditEntries(entries));
        }
        break;
      }

      default:
        console.error('Error: Unknown subcommand');
        console.log('Usage: ecm encryption <setup|status|rotate-key|backup-key|restore-key|audit>');
        process.exit(2);
    }
  },
};
