#!/usr/bin/env node
/**
 * Causantic Command-Line Interface
 *
 * Usage: npx causantic <command> [options]
 */

import type { Command } from './types.js';
import { initCommand } from './commands/init.js';
import { serveCommand } from './commands/serve.js';
import { ingestCommand, batchIngestCommand } from './commands/ingest.js';
import { recallCommand } from './commands/search.js';
import { maintenanceCommand } from './commands/maintenance.js';
import { configCommand } from './commands/config.js';
import { statsCommand, healthCommand } from './commands/stats.js';
import { hookCommand } from './commands/hook.js';
import { encryptionCommand } from './commands/encryption.js';
import { exportCommand, importCommand } from './commands/archive.js';
import { uninstallCommand } from './commands/uninstall.js';
import { dashboardCommand } from './commands/dashboard.js';

const VERSION = '0.1.0';

const commands: Command[] = [
  initCommand,
  serveCommand,
  ingestCommand,
  batchIngestCommand,
  recallCommand,
  maintenanceCommand,
  configCommand,
  statsCommand,
  healthCommand,
  hookCommand,
  encryptionCommand,
  exportCommand,
  importCommand,
  uninstallCommand,
  dashboardCommand,
];

function showHelp(): void {
  console.log('Causantic');
  console.log('');
  console.log('Usage: causantic <command> [options]');
  console.log('');
  console.log('Commands:');
  for (const cmd of commands) {
    console.log(`  ${cmd.name.padEnd(16)} ${cmd.description}`);
  }
  console.log('');
  console.log('Options:');
  console.log('  --version        Show version');
  console.log('  --help           Show help');
  console.log('');
  console.log('Run "causantic <command> --help" for command-specific help.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle global flags
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`causantic ${VERSION}`);
    return;
  }

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  // Find and run command
  const commandName = args[0];
  const command = commands.find((c) => c.name === commandName);

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.log('Run "causantic --help" for available commands.');
    process.exit(2);
  }

  try {
    await command.handler(args.slice(1));
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
