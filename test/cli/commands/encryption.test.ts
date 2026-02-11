/**
 * Tests for the encryption CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dynamically imported dependencies
vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/storage/encryption.js', () => ({
  generatePassword: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}));

vi.mock('../../../src/storage/db.js', () => ({
  storeDbKey: vi.fn(),
  getDbKeyAsync: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('../../../src/storage/audit-log.js', () => ({
  logAudit: vi.fn(),
  readAuditLog: vi.fn(),
  formatAuditEntries: vi.fn(),
}));

vi.mock('../../../src/cli/utils.js', () => ({
  promptPassword: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

import { encryptionCommand } from '../../../src/cli/commands/encryption.js';
import { loadConfig } from '../../../src/config/loader.js';
import { generatePassword, encryptString, decryptString } from '../../../src/storage/encryption.js';
import { storeDbKey, getDbKeyAsync, getDb } from '../../../src/storage/db.js';
import { logAudit, readAuditLog, formatAuditEntries } from '../../../src/storage/audit-log.js';
import { promptPassword } from '../../../src/cli/utils.js';
import * as fs from 'node:fs';

const mockLoadConfig = vi.mocked(loadConfig);
const mockGeneratePassword = vi.mocked(generatePassword);
const mockStoreDbKey = vi.mocked(storeDbKey);
const mockGetDbKeyAsync = vi.mocked(getDbKeyAsync);
const mockGetDb = vi.mocked(getDb);
const mockLogAudit = vi.mocked(logAudit);
const mockReadAuditLog = vi.mocked(readAuditLog);
const mockFormatAuditEntries = vi.mocked(formatAuditEntries);
const mockEncryptString = vi.mocked(encryptString);
const mockDecryptString = vi.mocked(decryptString);
const mockPromptPassword = vi.mocked(promptPassword);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  mockLoadConfig.mockReturnValue({
    encryption: { enabled: false, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
  } as ReturnType<typeof loadConfig>);
});

describe('encryptionCommand', () => {
  it('has correct name and usage', () => {
    expect(encryptionCommand.name).toBe('encryption');
    expect(encryptionCommand.usage).toContain('setup');
    expect(encryptionCommand.usage).toContain('status');
    expect(encryptionCommand.usage).toContain('rotate-key');
  });

  describe('setup subcommand', () => {
    it('sets up encryption when no database exists', async () => {
      mockExistsSync.mockReturnValue(false);
      mockGeneratePassword.mockReturnValue('generated-key-abc');
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['setup']);

      expect(mockGeneratePassword).toHaveBeenCalledWith(32);
      expect(mockStoreDbKey).toHaveBeenCalledWith('generated-key-abc');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Encryption key stored'));
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Encryption enabled'));
    });

    it('warns and exits when unencrypted database exists', async () => {
      // First call: dbPath existsSync -> true
      // Second call: configPath existsSync (not reached due to exit)
      mockExistsSync.mockReturnValueOnce(true);

      // Simulate reading SQLite header
      const sqliteHeader = Buffer.alloc(16);
      sqliteHeader.write('SQLite format 3', 0, 'utf-8');
      mockOpenSync.mockReturnValue(42 as unknown as number);
      mockReadSync.mockImplementation((_fd, buffer: Buffer) => {
        sqliteHeader.copy(buffer, 0, 0, 16);
        return 16;
      });

      await encryptionCommand.handler(['setup']);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Existing unencrypted database detected'),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockCloseSync).toHaveBeenCalledWith(42);
    });

    it('proceeds when existing database is already encrypted', async () => {
      // existsSync: dbPath -> true, configPath -> false, configDir -> false
      mockExistsSync.mockReturnValueOnce(true).mockReturnValue(false);

      // Simulate reading an encrypted header (not "SQLite format 3")
      const encryptedHeader = Buffer.alloc(16);
      encryptedHeader.write('ENCRYPTED_DATA!', 0, 'utf-8');
      mockOpenSync.mockReturnValue(43 as unknown as number);
      mockReadSync.mockImplementation((_fd, buffer: Buffer) => {
        encryptedHeader.copy(buffer, 0, 0, 16);
        return 16;
      });

      mockGeneratePassword.mockReturnValue('new-key');
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['setup']);

      expect(process.exit).not.toHaveBeenCalled();
      expect(mockStoreDbKey).toHaveBeenCalledWith('new-key');
    });

    it('writes correct encryption config to config.json', async () => {
      // No database exists
      mockExistsSync.mockReturnValue(false);
      mockGeneratePassword.mockReturnValue('key123');
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['setup']);

      // Verify the config written includes encryption settings
      const writeCall = mockWriteFileSync.mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.encryption).toEqual({
        enabled: true,
        cipher: 'chacha20',
        keySource: 'keychain',
      });
    });

    it('merges with existing config.json', async () => {
      // existsSync: dbPath -> false, configPath -> true, configDir -> true
      mockExistsSync
        .mockReturnValueOnce(false)  // dbPath
        .mockReturnValueOnce(true)   // configPath
        .mockReturnValueOnce(true);  // configDir

      mockReadFileSync.mockReturnValue('{"llm":{"clusterRefreshModel":"claude-3-haiku"}}');
      mockGeneratePassword.mockReturnValue('key456');
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['setup']);

      const writeCall = mockWriteFileSync.mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.llm).toEqual({ clusterRefreshModel: 'claude-3-haiku' });
      expect(writtenConfig.encryption.enabled).toBe(true);
    });
  });

  describe('status subcommand', () => {
    it('shows disabled status when encryption is off', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: false, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
      } as ReturnType<typeof loadConfig>);

      await encryptionCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('Database Encryption Status:');
      expect(console.log).toHaveBeenCalledWith('  Enabled: no');
    });

    it('shows full status when encryption is enabled', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain', auditLog: true },
      } as ReturnType<typeof loadConfig>);

      await encryptionCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('  Enabled: yes');
      expect(console.log).toHaveBeenCalledWith('  Cipher: chacha20');
      expect(console.log).toHaveBeenCalledWith('  Key source: keychain');
      expect(console.log).toHaveBeenCalledWith('  Audit logging: yes');
    });

    it('uses default values when encryption config fields are undefined', async () => {
      mockLoadConfig.mockReturnValue({} as ReturnType<typeof loadConfig>);

      await encryptionCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('  Enabled: no');
    });
  });

  describe('rotate-key subcommand', () => {
    it('rotates encryption key successfully', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
      } as ReturnType<typeof loadConfig>);

      mockGetDbKeyAsync.mockResolvedValue('current-key');
      mockGeneratePassword.mockReturnValue('new-rotated-key');
      const mockDb = { pragma: vi.fn() };
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['rotate-key']);

      expect(mockGetDbKeyAsync).toHaveBeenCalledOnce();
      expect(mockGeneratePassword).toHaveBeenCalledWith(32);
      expect(mockDb.pragma).toHaveBeenCalledWith("rekey = 'new-rotated-key'");
      expect(mockStoreDbKey).toHaveBeenCalledWith('new-rotated-key');
      expect(mockLogAudit).toHaveBeenCalledWith('key-rotate', 'Encryption key rotated');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('rotated successfully'));
    });

    it('exits with code 1 when encryption is not enabled', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: false, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
      } as ReturnType<typeof loadConfig>);

      await encryptionCommand.handler(['rotate-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Encryption is not enabled.');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits with code 1 when current key cannot be retrieved', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
      } as ReturnType<typeof loadConfig>);
      mockGetDbKeyAsync.mockResolvedValue(undefined);

      await encryptionCommand.handler(['rotate-key']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: Could not retrieve current encryption key.',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits with code 1 when rekey fails', async () => {
      mockLoadConfig.mockReturnValue({
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain', auditLog: false },
      } as ReturnType<typeof loadConfig>);
      mockGetDbKeyAsync.mockResolvedValue('current-key');
      mockGeneratePassword.mockReturnValue('new-key');
      const mockDb = { pragma: vi.fn(() => { throw new Error('Rekey failed'); }) };
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

      await encryptionCommand.handler(['rotate-key']);

      expect(console.error).toHaveBeenCalledWith('Error rotating key: Rekey failed');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('backup-key subcommand', () => {
    it('backs up key to specified path', async () => {
      mockGetDbKeyAsync.mockResolvedValue('my-db-key');
      mockPromptPassword
        .mockResolvedValueOnce('backup-pass')
        .mockResolvedValueOnce('backup-pass');
      mockEncryptString.mockReturnValue('encrypted-key-data');

      await encryptionCommand.handler(['backup-key', '/tmp/backup.enc']);

      expect(mockGetDbKeyAsync).toHaveBeenCalledOnce();
      expect(mockPromptPassword).toHaveBeenCalledTimes(2);
      expect(mockEncryptString).toHaveBeenCalledWith('my-db-key', 'backup-pass');
      expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/backup.enc', 'encrypted-key-data');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('/tmp/backup.enc'));
    });

    it('uses default filename when no path specified', async () => {
      mockGetDbKeyAsync.mockResolvedValue('my-db-key');
      mockPromptPassword
        .mockResolvedValueOnce('pass')
        .mockResolvedValueOnce('pass');
      mockEncryptString.mockReturnValue('encrypted');

      await encryptionCommand.handler(['backup-key']);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'causantic-key-backup.enc',
        'encrypted',
      );
    });

    it('exits with code 1 when no encryption key is found', async () => {
      mockGetDbKeyAsync.mockResolvedValue(undefined);

      await encryptionCommand.handler(['backup-key']);

      expect(console.error).toHaveBeenCalledWith('Error: No encryption key found.');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits with code 2 when backup password is empty', async () => {
      mockGetDbKeyAsync.mockResolvedValue('key');
      mockPromptPassword.mockResolvedValueOnce('');

      await encryptionCommand.handler(['backup-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Backup password required.');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('exits with code 2 when passwords do not match', async () => {
      mockGetDbKeyAsync.mockResolvedValue('key');
      mockPromptPassword
        .mockResolvedValueOnce('password1')
        .mockResolvedValueOnce('password2');

      await encryptionCommand.handler(['backup-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Passwords do not match.');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('restore-key subcommand', () => {
    it('restores key from backup file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('encrypted-key-base64');
      mockPromptPassword.mockResolvedValue('backup-pass');
      mockDecryptString.mockReturnValue('restored-db-key');
      mockStoreDbKey.mockResolvedValue(undefined);

      await encryptionCommand.handler(['restore-key', '/tmp/backup.enc']);

      expect(mockDecryptString).toHaveBeenCalledWith('encrypted-key-base64', 'backup-pass');
      expect(mockStoreDbKey).toHaveBeenCalledWith('restored-db-key');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('restored successfully'));
    });

    it('exits with code 2 when no backup file path is given', async () => {
      await encryptionCommand.handler(['restore-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Backup file path required');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('exits with code 1 when backup file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await encryptionCommand.handler(['restore-key', '/nonexistent/path.enc']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: File not found: /nonexistent/path.enc',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits with code 1 when decryption fails (wrong password)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('encrypted-data');
      mockPromptPassword.mockResolvedValue('wrong-pass');
      mockDecryptString.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await encryptionCommand.handler(['restore-key', '/tmp/backup.enc']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: Failed to decrypt. Wrong password?',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('audit subcommand', () => {
    it('displays audit entries', async () => {
      const entries = [
        { timestamp: '2026-02-10T10:00:00Z', action: 'open' as const, details: 'DB opened', pid: 1234 },
        { timestamp: '2026-02-10T10:01:00Z', action: 'key-rotate' as const, details: 'Key rotated', pid: 1234 },
      ];
      mockReadAuditLog.mockReturnValue(entries);
      mockFormatAuditEntries.mockReturnValue('formatted-entries-output');

      await encryptionCommand.handler(['audit']);

      expect(mockReadAuditLog).toHaveBeenCalledWith(10);
      expect(console.log).toHaveBeenCalledWith('Last 2 audit entries:');
      expect(console.log).toHaveBeenCalledWith('formatted-entries-output');
    });

    it('uses custom limit when provided', async () => {
      mockReadAuditLog.mockReturnValue([
        { timestamp: '2026-02-10T10:00:00Z', action: 'open' as const, pid: 1234 },
      ]);
      mockFormatAuditEntries.mockReturnValue('output');

      await encryptionCommand.handler(['audit', '25']);

      expect(mockReadAuditLog).toHaveBeenCalledWith(25);
    });

    it('shows help message when no audit entries exist', async () => {
      mockReadAuditLog.mockReturnValue([]);

      await encryptionCommand.handler(['audit']);

      expect(console.log).toHaveBeenCalledWith('No audit entries found.');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('audit logging'),
      );
    });
  });

  describe('unknown subcommand', () => {
    it('prints error and exits with code 2', async () => {
      await encryptionCommand.handler(['unknown']);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('handles no subcommand provided', async () => {
      await encryptionCommand.handler([]);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });
});
