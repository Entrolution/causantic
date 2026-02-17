/**
 * Tests for the export and import CLI command handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the commands
vi.mock('../../../src/storage/archive.js', () => ({
  exportArchive: vi.fn(),
  importArchive: vi.fn(),
}));

vi.mock('../../../src/cli/utils.js', () => ({
  promptPassword: vi.fn(),
  isEncryptedArchive: vi.fn(),
}));

import { exportCommand, importCommand } from '../../../src/cli/commands/archive.js';
import { exportArchive, importArchive } from '../../../src/storage/archive.js';
import { promptPassword, isEncryptedArchive } from '../../../src/cli/utils.js';

const mockExportArchive = vi.mocked(exportArchive);
const mockImportArchive = vi.mocked(importArchive);
const mockPromptPassword = vi.mocked(promptPassword);
const mockIsEncryptedArchive = vi.mocked(isEncryptedArchive);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

const sampleExportResult = {
  chunkCount: 100,
  edgeCount: 50,
  clusterCount: 10,
  vectorCount: 100,
  fileSize: 2048,
  compressed: true,
  encrypted: true,
};

const sampleImportResult = {
  chunkCount: 100,
  edgeCount: 50,
  clusterCount: 10,
  vectorCount: 100,
  dryRun: false,
};

describe('exportCommand', () => {
  it('has correct name and usage', () => {
    expect(exportCommand.name).toBe('export');
    expect(exportCommand.usage).toContain('--output');
    expect(exportCommand.usage).toContain('--no-encrypt');
  });

  it('exports unencrypted with --no-encrypt flag', async () => {
    mockExportArchive.mockResolvedValue(sampleExportResult);

    await exportCommand.handler(['--no-encrypt', '--output', '/tmp/backup.causantic']);

    expect(mockExportArchive).toHaveBeenCalledWith({
      outputPath: '/tmp/backup.causantic',
      password: undefined,
      projects: undefined,
      redactPaths: false,
      redactCode: false,
      noVectors: false,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('100 chunks'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('50 edges'));
  });

  it('uses default output path when --output is not specified', async () => {
    mockExportArchive.mockResolvedValue(sampleExportResult);

    await exportCommand.handler(['--no-encrypt']);

    expect(mockExportArchive).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: 'causantic-backup.causantic' }),
    );
  });

  it('passes --projects flag correctly', async () => {
    mockExportArchive.mockResolvedValue(sampleExportResult);

    await exportCommand.handler(['--no-encrypt', '--projects', 'proj-a,proj-b']);

    expect(mockExportArchive).toHaveBeenCalledWith(
      expect.objectContaining({ projects: ['proj-a', 'proj-b'] }),
    );
  });

  it('passes --redact-paths and --redact-code flags', async () => {
    mockExportArchive.mockResolvedValue(sampleExportResult);

    await exportCommand.handler(['--no-encrypt', '--redact-paths', '--redact-code']);

    expect(mockExportArchive).toHaveBeenCalledWith(
      expect.objectContaining({ redactPaths: true, redactCode: true }),
    );
  });

  it('passes --no-vectors flag', async () => {
    mockExportArchive.mockResolvedValue(sampleExportResult);

    await exportCommand.handler(['--no-encrypt', '--no-vectors']);

    expect(mockExportArchive).toHaveBeenCalledWith(expect.objectContaining({ noVectors: true }));
  });

  it('uses password from environment variable', async () => {
    const originalEnv = process.env.CAUSANTIC_EXPORT_PASSWORD;
    process.env.CAUSANTIC_EXPORT_PASSWORD = 'env-password';

    try {
      mockExportArchive.mockResolvedValue(sampleExportResult);

      await exportCommand.handler(['--output', '/tmp/backup.causantic']);

      expect(mockExportArchive).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'env-password' }),
      );
      expect(mockPromptPassword).not.toHaveBeenCalled();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CAUSANTIC_EXPORT_PASSWORD;
      } else {
        process.env.CAUSANTIC_EXPORT_PASSWORD = originalEnv;
      }
    }
  });

  it('exits with code 2 when no password and not TTY', async () => {
    const originalEnv = process.env.CAUSANTIC_EXPORT_PASSWORD;
    delete process.env.CAUSANTIC_EXPORT_PASSWORD;
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      await exportCommand.handler([]);

      expect(console.error).toHaveBeenCalledWith(
        'Error: No password provided for encrypted export.',
      );
      expect(process.exit).toHaveBeenCalledWith(2);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      if (originalEnv !== undefined) {
        process.env.CAUSANTIC_EXPORT_PASSWORD = originalEnv;
      }
    }
  });

  it('shows compressed and encrypted in output', async () => {
    mockExportArchive.mockResolvedValue({
      ...sampleExportResult,
      compressed: true,
      encrypted: true,
    });

    await exportCommand.handler(['--no-encrypt']);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('compressed'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('encrypted'));
  });
});

describe('importCommand', () => {
  it('has correct name and usage', () => {
    expect(importCommand.name).toBe('import');
    expect(importCommand.usage).toContain('--merge');
    expect(importCommand.usage).toContain('--dry-run');
  });

  it('imports unencrypted archive', async () => {
    mockIsEncryptedArchive.mockResolvedValue(false);
    mockImportArchive.mockResolvedValue(sampleImportResult);

    await importCommand.handler(['/tmp/backup.causantic']);

    expect(mockIsEncryptedArchive).toHaveBeenCalledWith('/tmp/backup.causantic');
    expect(mockImportArchive).toHaveBeenCalledWith({
      inputPath: '/tmp/backup.causantic',
      password: undefined,
      merge: false,
      dryRun: false,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Imported:'));
  });

  it('passes --merge flag', async () => {
    mockIsEncryptedArchive.mockResolvedValue(false);
    mockImportArchive.mockResolvedValue(sampleImportResult);

    await importCommand.handler(['/tmp/backup.causantic', '--merge']);

    expect(mockImportArchive).toHaveBeenCalledWith(expect.objectContaining({ merge: true }));
  });

  it('passes --dry-run flag', async () => {
    mockIsEncryptedArchive.mockResolvedValue(false);
    mockImportArchive.mockResolvedValue({ ...sampleImportResult, dryRun: true });

    await importCommand.handler(['/tmp/backup.causantic', '--dry-run']);

    expect(mockImportArchive).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
  });

  it('exits with code 2 when no file path provided', async () => {
    await importCommand.handler([]);

    expect(console.error).toHaveBeenCalledWith('Error: File path required');
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('uses password from environment for encrypted archive', async () => {
    const originalEnv = process.env.CAUSANTIC_EXPORT_PASSWORD;
    process.env.CAUSANTIC_EXPORT_PASSWORD = 'env-password';

    try {
      mockIsEncryptedArchive.mockResolvedValue(true);
      mockImportArchive.mockResolvedValue(sampleImportResult);

      await importCommand.handler(['/tmp/backup.causantic']);

      expect(mockImportArchive).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'env-password' }),
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CAUSANTIC_EXPORT_PASSWORD;
      } else {
        process.env.CAUSANTIC_EXPORT_PASSWORD = originalEnv;
      }
    }
  });

  it('exits with code 2 when encrypted and no password and not TTY', async () => {
    const originalEnv = process.env.CAUSANTIC_EXPORT_PASSWORD;
    delete process.env.CAUSANTIC_EXPORT_PASSWORD;
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      mockIsEncryptedArchive.mockResolvedValue(true);

      await importCommand.handler(['/tmp/backup.causantic']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: Archive is encrypted. Set CAUSANTIC_EXPORT_PASSWORD environment variable.',
      );
      expect(process.exit).toHaveBeenCalledWith(2);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      if (originalEnv !== undefined) {
        process.env.CAUSANTIC_EXPORT_PASSWORD = originalEnv;
      }
    }
  });

  it('finds file path when flags come before it', async () => {
    mockIsEncryptedArchive.mockResolvedValue(false);
    mockImportArchive.mockResolvedValue(sampleImportResult);

    await importCommand.handler(['--merge', '/tmp/backup.causantic']);

    expect(mockImportArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: '/tmp/backup.causantic',
        merge: true,
      }),
    );
  });
});
