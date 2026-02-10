import type { Command } from '../types.js';
import { promptPassword, isEncryptedArchive } from '../utils.js';

export const exportCommand: Command = {
  name: 'export',
  description: 'Export memory data',
  usage: 'ecm export --output <path> [--no-encrypt]',
  handler: async (args) => {
    const { exportArchive } = await import('../../storage/archive.js');
    const outputIndex = args.indexOf('--output');
    const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'ecm-backup.ecm';
    const noEncrypt = args.includes('--no-encrypt');

    let password: string | undefined;
    if (!noEncrypt) {
      password = process.env.ECM_EXPORT_PASSWORD;

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
        console.log('Set ECM_EXPORT_PASSWORD environment variable or use --no-encrypt.');
        process.exit(2);
      }
    }

    await exportArchive({
      outputPath,
      password,
    });
    console.log(`Exported to ${outputPath}`);
  },
};

export const importCommand: Command = {
  name: 'import',
  description: 'Import memory data',
  usage: 'ecm import <file> [--merge]',
  handler: async (args) => {
    if (args.length === 0) {
      console.error('Error: File path required');
      process.exit(2);
    }
    const { importArchive } = await import('../../storage/archive.js');
    const inputPath = args[0];
    const merge = args.includes('--merge');

    const encrypted = await isEncryptedArchive(inputPath);

    let password: string | undefined;
    if (encrypted) {
      password = process.env.ECM_EXPORT_PASSWORD;

      if (!password && process.stdin.isTTY) {
        password = await promptPassword('Enter decryption password: ');
        if (!password) {
          console.error('Error: Password required for encrypted archive.');
          process.exit(2);
        }
      } else if (!password) {
        console.error('Error: Archive is encrypted. Set ECM_EXPORT_PASSWORD environment variable.');
        process.exit(2);
      }
    }

    await importArchive({
      inputPath,
      password,
      merge,
    });
    console.log('Import complete.');
  },
};
