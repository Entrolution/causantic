import type { Command } from '../types.js';
import { promptPassword, isEncryptedArchive } from '../utils.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export const exportCommand: Command = {
  name: 'export',
  description: 'Export memory data',
  usage:
    'causantic export --output <path> [--no-encrypt] [--projects <slugs>] [--redact-paths] [--redact-code] [--no-vectors]',
  handler: async (args) => {
    const { exportArchive } = await import('../../storage/archive.js');
    const outputIndex = args.indexOf('--output');
    const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'causantic-backup.causantic';
    const noEncrypt = args.includes('--no-encrypt');
    const noVectors = args.includes('--no-vectors');
    const redactPaths = args.includes('--redact-paths');
    const redactCode = args.includes('--redact-code');

    // Parse --projects flag
    const projectsIndex = args.indexOf('--projects');
    const projects =
      projectsIndex >= 0 && args[projectsIndex + 1]
        ? args[projectsIndex + 1].split(',').map((s) => s.trim())
        : undefined;

    let password: string | undefined;
    if (!noEncrypt) {
      password = process.env.CAUSANTIC_EXPORT_PASSWORD;

      if (!password && process.stdin.isTTY) {
        password = await promptPassword('Enter encryption password: ');
        if (!password) {
          console.error('Error: Password required for encrypted export.');
          console.log('Use --no-encrypt for unencrypted export.');
          process.exit(2);
        }
        const confirm = await promptPassword('Confirm password: ');
        if (password !== confirm) {
          console.error('Error: Passwords do not match.');
          process.exit(2);
        }
      } else if (!password) {
        console.error('Error: No password provided for encrypted export.');
        console.log('Set CAUSANTIC_EXPORT_PASSWORD environment variable or use --no-encrypt.');
        process.exit(2);
      }
    }

    const result = await exportArchive({
      outputPath,
      password,
      projects,
      redactPaths,
      redactCode,
      noVectors,
    });

    const parts = [
      `${formatCount(result.chunkCount)} chunks`,
      `${formatCount(result.edgeCount)} edges`,
      `${formatCount(result.clusterCount)} clusters`,
      `${formatCount(result.vectorCount)} vectors`,
    ];
    const suffix = [
      result.compressed ? 'compressed' : null,
      result.encrypted ? 'encrypted' : null,
    ]
      .filter(Boolean)
      .join(', ');

    console.log(`Exported: ${parts.join(', ')} (${formatSize(result.fileSize)} ${suffix})`);
    console.log(`File: ${outputPath}`);
  },
};

export const importCommand: Command = {
  name: 'import',
  description: 'Import memory data',
  usage: 'causantic import <file> [--merge] [--dry-run]',
  handler: async (args) => {
    if (args.length === 0) {
      console.error('Error: File path required');
      process.exit(2);
    }
    const { importArchive } = await import('../../storage/archive.js');

    // Find file path (first arg that isn't a flag)
    const inputPath = args.find((a) => !a.startsWith('--'))!;
    const merge = args.includes('--merge');
    const dryRun = args.includes('--dry-run');

    const encrypted = await isEncryptedArchive(inputPath);

    let password: string | undefined;
    if (encrypted) {
      password = process.env.CAUSANTIC_EXPORT_PASSWORD;

      if (!password && process.stdin.isTTY) {
        password = await promptPassword('Enter decryption password: ');
        if (!password) {
          console.error('Error: Password required for encrypted archive.');
          process.exit(2);
        }
      } else if (!password) {
        console.error(
          'Error: Archive is encrypted. Set CAUSANTIC_EXPORT_PASSWORD environment variable.',
        );
        process.exit(2);
      }
    }

    const result = await importArchive({
      inputPath,
      password,
      merge,
      dryRun,
    });

    const parts = [
      `${formatCount(result.chunkCount)} chunks`,
      `${formatCount(result.edgeCount)} edges`,
      `${formatCount(result.clusterCount)} clusters`,
      `${formatCount(result.vectorCount)} vectors`,
    ];

    if (result.dryRun) {
      console.log(`Dry run — would import: ${parts.join(', ')}`);
    } else {
      console.log(`Imported: ${parts.join(', ')}`);
    }
  },
};
