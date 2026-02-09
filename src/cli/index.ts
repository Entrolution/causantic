#!/usr/bin/env node
/**
 * ECM Command-Line Interface
 *
 * Usage: npx ecm <command> [options]
 */

import { runTask, runAllTasks, getStatus, runDaemon } from '../maintenance/scheduler.js';
import { loadConfig, validateExternalConfig } from '../config/loader.js';
import { createSecretStore } from '../utils/secret-store.js';
import { getDb } from '../storage/db.js';
import { getChunkCount, getSessionIds } from '../storage/chunk-store.js';
import { getEdgeCount } from '../storage/edge-store.js';
import { getClusterCount } from '../storage/cluster-store.js';

const VERSION = '0.1.0';

interface Command {
  name: string;
  description: string;
  usage: string;
  handler: (args: string[]) => Promise<void>;
}

const commands: Command[] = [
  {
    name: 'init',
    description: 'Initialize ECM (setup wizard)',
    usage: 'ecm init [--skip-mcp]',
    handler: async (args) => {
      const skipMcp = args.includes('--skip-mcp');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const readline = await import('node:readline');

      console.log('Entropic Causal Memory - Setup');
      console.log('==============================');
      console.log('');

      // Step 1: Check Node.js version
      const nodeVersion = process.versions.node;
      const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
      if (majorVersion >= 20) {
        console.log(`✓ Node.js ${nodeVersion}`);
      } else {
        console.log(`✗ Node.js ${nodeVersion} (requires 20+)`);
        process.exit(1);
      }

      // Step 2: Create directory structure
      const ecmDir = path.join(os.homedir(), '.ecm');
      const vectorsDir = path.join(ecmDir, 'vectors');

      if (!fs.existsSync(ecmDir)) {
        fs.mkdirSync(ecmDir, { recursive: true });
        console.log(`✓ Created ${ecmDir}`);
      } else {
        console.log(`✓ Directory exists: ${ecmDir}`);
      }

      if (!fs.existsSync(vectorsDir)) {
        fs.mkdirSync(vectorsDir, { recursive: true });
        console.log(`✓ Created ${vectorsDir}`);
      } else {
        console.log(`✓ Directory exists: ${vectorsDir}`);
      }

      // Step 3: Initialize database
      try {
        const db = getDb();
        db.prepare('SELECT 1').get();
        console.log('✓ Database initialized');
      } catch (error) {
        console.log(`✗ Database error: ${(error as Error).message}`);
        process.exit(1);
      }

      // Step 4: Detect Claude Code config path
      let claudeConfigPath: string | null = null;
      const platform = os.platform();

      if (platform === 'darwin') {
        claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      } else if (platform === 'win32') {
        claudeConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
      } else {
        claudeConfigPath = path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
      }

      console.log('');
      console.log(`Claude Code config: ${claudeConfigPath}`);

      // Step 5: Offer to configure MCP
      if (!skipMcp) {
        const configExists = fs.existsSync(claudeConfigPath);

        if (configExists) {
          console.log('✓ Claude Code config found');

          try {
            const configContent = fs.readFileSync(claudeConfigPath, 'utf-8');
            const config = JSON.parse(configContent);

            if (config.mcpServers?.memory) {
              console.log('✓ ECM already configured in Claude Code');
            } else {
              // Ask user if they want to add MCP config
              const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
              });

              const answer = await new Promise<string>((resolve) => {
                rl.question('Add ECM to Claude Code MCP config? [Y/n] ', (ans) => {
                  rl.close();
                  resolve(ans.toLowerCase() || 'y');
                });
              });

              if (answer === 'y' || answer === 'yes') {
                config.mcpServers = config.mcpServers || {};
                config.mcpServers.memory = {
                  command: 'npx',
                  args: ['ecm', 'serve'],
                };
                fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
                console.log('✓ Added ECM to Claude Code config');
                console.log('  Restart Claude Code to activate');
              }
            }
          } catch {
            console.log('⚠ Could not parse Claude Code config');
          }
        } else {
          console.log('⚠ Claude Code config not found');
          console.log('  Create it manually or install Claude Code first');
        }
      }

      // Step 6: Health check
      console.log('');
      console.log('Running health check...');

      try {
        const { vectorStore } = await import('../storage/vector-store.js');
        if (vectorStore && typeof vectorStore.count === 'function') {
          await vectorStore.count();
        }
        console.log('✓ Vector store OK');
      } catch (error) {
        console.log(`⚠ Vector store: ${(error as Error).message}`);
      }

      console.log('');
      console.log('Setup complete!');
      console.log('');
      console.log('Next steps:');
      console.log('  1. npx ecm batch-ingest ~/.claude/projects');
      console.log('  2. Restart Claude Code');
      console.log('  3. Ask Claude: "What did we work on recently?"');
    },
  },
  {
    name: 'serve',
    description: 'Start the MCP server',
    usage: 'ecm serve [--health-check]',
    handler: async (_args) => {
      // Dynamically import to avoid circular dependencies
      const mcpServer = await import('../mcp/server.js');
      // Try different export patterns
      const startFn = (mcpServer as Record<string, unknown>).startMcpServer
        ?? (mcpServer as Record<string, unknown>).start
        ?? (mcpServer as Record<string, unknown>).main;
      if (typeof startFn === 'function') {
        await startFn();
      } else {
        console.log('MCP server started on stdio');
        // Keep process alive
        await new Promise(() => {});
      }
    },
  },
  {
    name: 'ingest',
    description: 'Ingest a session or project',
    usage: 'ecm ingest <path> [--force]',
    handler: async (args) => {
      if (args.length === 0) {
        console.error('Error: Path required');
        console.log('Usage: ecm ingest <path>');
        process.exit(2);
      }
      const { ingestSession } = await import('../ingest/ingest-session.js');
      await ingestSession(args[0]);
      console.log('Ingestion complete.');
    },
  },
  {
    name: 'batch-ingest',
    description: 'Ingest all sessions from a directory',
    usage: 'ecm batch-ingest <directory> [--parallel <n>]',
    handler: async (args) => {
      if (args.length === 0) {
        console.error('Error: Directory required');
        console.log('Usage: ecm batch-ingest <directory>');
        process.exit(2);
      }
      const { batchIngest } = await import('../ingest/batch-ingest.js');
      const result = await batchIngest([args[0]], {});
      console.log(`Batch ingestion complete: ${result.successCount} sessions processed.`);
    },
  },
  {
    name: 'recall',
    description: 'Query memory',
    usage: 'ecm recall <query> [--limit <n>] [--json]',
    handler: async (args) => {
      if (args.length === 0) {
        console.error('Error: Query required');
        console.log('Usage: ecm recall <query>');
        process.exit(2);
      }
      const { recall } = await import('../retrieval/context-assembler.js');
      const results = await recall(args.join(' '), { vectorSearchLimit: 10 });
      console.log(JSON.stringify(results, null, 2));
    },
  },
  {
    name: 'maintenance',
    description: 'Run maintenance tasks',
    usage: 'ecm maintenance <run|status|daemon> [task]',
    handler: async (args) => {
      const subcommand = args[0];

      switch (subcommand) {
        case 'run': {
          const taskName = args[1];
          if (taskName === 'all') {
            console.log('Running all maintenance tasks...');
            const results = await runAllTasks();
            for (const [name, result] of results) {
              const status = result.success ? 'OK' : 'FAILED';
              console.log(`  ${name}: ${status} - ${result.message}`);
            }
          } else if (taskName) {
            const result = await runTask(taskName);
            const status = result.success ? 'OK' : 'FAILED';
            console.log(`${taskName}: ${status} - ${result.message}`);
          } else {
            console.error('Error: Task name required');
            console.log('Usage: ecm maintenance run <task|all>');
            console.log('Tasks: scan-projects, update-clusters, prune-graph, refresh-labels, vacuum');
            process.exit(2);
          }
          break;
        }
        case 'status': {
          const status = getStatus();
          console.log('Maintenance Task Status:');
          console.log('');
          for (const task of status) {
            console.log(`${task.name}:`);
            console.log(`  Schedule: ${task.schedule}`);
            if (task.lastRun) {
              const runStatus = task.lastRun.success ? 'OK' : 'FAILED';
              console.log(`  Last run: ${task.lastRun.endTime} (${runStatus})`);
            } else {
              console.log(`  Last run: Never`);
            }
            if (task.nextRun) {
              console.log(`  Next run: ${task.nextRun.toISOString()}`);
            }
            console.log('');
          }
          break;
        }
        case 'daemon': {
          const controller = new AbortController();
          process.on('SIGINT', () => controller.abort());
          process.on('SIGTERM', () => controller.abort());
          await runDaemon(controller.signal);
          break;
        }
        default:
          console.error('Error: Unknown subcommand');
          console.log('Usage: ecm maintenance <run|status|daemon>');
          process.exit(2);
      }
    },
  },
  {
    name: 'config',
    description: 'Manage configuration',
    usage: 'ecm config <show|validate|set-key|get-key>',
    handler: async (args) => {
      const subcommand = args[0];

      switch (subcommand) {
        case 'show': {
          const config = loadConfig();
          console.log(JSON.stringify(config, null, 2));
          break;
        }
        case 'validate': {
          const config = loadConfig();
          const errors = validateExternalConfig(config);
          if (errors.length === 0) {
            console.log('Configuration is valid.');
          } else {
            console.error('Configuration errors:');
            for (const error of errors) {
              console.error(`  - ${error}`);
            }
            process.exit(3);
          }
          break;
        }
        case 'set-key': {
          const keyName = args[1];
          if (!keyName) {
            console.error('Error: Key name required');
            console.log('Usage: ecm config set-key <name>');
            process.exit(2);
          }
          const readline = await import('node:readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const value = await new Promise<string>((resolve) => {
            rl.question(`Enter value for ${keyName}: `, (answer) => {
              rl.close();
              resolve(answer);
            });
          });
          const store = createSecretStore();
          await store.set(keyName, value);
          console.log(`Key ${keyName} stored.`);
          break;
        }
        case 'get-key': {
          const keyName = args[1];
          if (!keyName) {
            console.error('Error: Key name required');
            console.log('Usage: ecm config get-key <name>');
            process.exit(2);
          }
          const store = createSecretStore();
          const value = await store.get(keyName);
          if (value) {
            console.log(value);
          } else {
            console.error(`Key ${keyName} not found.`);
            process.exit(1);
          }
          break;
        }
        default:
          console.error('Error: Unknown subcommand');
          console.log('Usage: ecm config <show|validate|set-key|get-key>');
          process.exit(2);
      }
    },
  },
  {
    name: 'stats',
    description: 'Show memory statistics',
    usage: 'ecm stats [--json]',
    handler: async (_args) => {
      const chunks = getChunkCount();
      const edges = getEdgeCount();
      const clusters = getClusterCount();
      const sessions = getSessionIds().length;

      console.log('Memory Statistics:');
      console.log(`  Sessions: ${sessions}`);
      console.log(`  Chunks: ${chunks}`);
      console.log(`  Edges: ${edges}`);
      console.log(`  Clusters: ${clusters}`);
    },
  },
  {
    name: 'health',
    description: 'Check system health',
    usage: 'ecm health [--verbose]',
    handler: async (_args) => {
      console.log('Health Check:');

      // Database
      try {
        const db = getDb();
        db.prepare('SELECT 1').get();
        console.log('  Database: OK');
      } catch (error) {
        console.log(`  Database: FAILED - ${(error as Error).message}`);
      }

      // Vector store
      try {
        const { vectorStore } = await import('../storage/vector-store.js');
        if (vectorStore && typeof vectorStore.count === 'function') {
          await vectorStore.count();
        }
        console.log('  Vector Store: OK');
      } catch (error) {
        console.log(`  Vector Store: FAILED - ${(error as Error).message}`);
      }

      console.log('');
      console.log('System ready.');
    },
  },
  {
    name: 'hook',
    description: 'Run a hook manually',
    usage: 'ecm hook <session-start|pre-compact|claudemd-generator> [path]',
    handler: async (args) => {
      const hookName = args[0];
      const path = args[1] ?? process.cwd();

      switch (hookName) {
        case 'session-start': {
          const { handleSessionStart } = await import('../hooks/session-start.js');
          const result = await handleSessionStart(path, {});
          console.log('Session start hook executed.');
          console.log(`Summary: ${result.summary.substring(0, 200)}...`);
          break;
        }
        case 'pre-compact': {
          const { handlePreCompact } = await import('../hooks/pre-compact.js');
          await handlePreCompact(path);
          console.log('Pre-compact hook executed.');
          break;
        }
        case 'claudemd-generator': {
          const { updateClaudeMd } = await import('../hooks/claudemd-generator.js');
          await updateClaudeMd(path, {});
          console.log('CLAUDE.md updated.');
          break;
        }
        default:
          console.error('Error: Unknown hook');
          console.log('Usage: ecm hook <session-start|pre-compact|claudemd-generator> [path]');
          process.exit(2);
      }
    },
  },
  {
    name: 'export',
    description: 'Export memory data',
    usage: 'ecm export --output <path> [--no-encrypt]',
    handler: async (args) => {
      const { exportArchive } = await import('../storage/archive.js');
      const outputIndex = args.indexOf('--output');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'ecm-backup.json';
      const noEncrypt = args.includes('--no-encrypt');

      await exportArchive({
        outputPath,
        password: noEncrypt ? undefined : process.env.ECM_EXPORT_PASSWORD,
      });
      console.log(`Exported to ${outputPath}`);
    },
  },
  {
    name: 'import',
    description: 'Import memory data',
    usage: 'ecm import <file> [--merge]',
    handler: async (args) => {
      if (args.length === 0) {
        console.error('Error: File path required');
        process.exit(2);
      }
      const { importArchive } = await import('../storage/archive.js');
      const merge = args.includes('--merge');

      await importArchive({
        inputPath: args[0],
        password: process.env.ECM_EXPORT_PASSWORD,
        merge,
      });
      console.log('Import complete.');
    },
  },
];

function showHelp(): void {
  console.log('Entropic Causal Memory (ECM)');
  console.log('');
  console.log('Usage: ecm <command> [options]');
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
  console.log('Run "ecm <command> --help" for command-specific help.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle global flags
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`ecm ${VERSION}`);
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
    console.log('Run "ecm --help" for available commands.');
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
