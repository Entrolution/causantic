import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Command } from '../../types.js';
import { getDb } from '../../../storage/db.js';
import { setupEncryption } from './encryption.js';
import { migrateMcpFromSettings, configureMcp, patchProjectMcpFiles } from './mcp-config.js';
import { configureHooks } from './hooks.js';
import { installSkillsAndClaudeMd } from './skills.js';
import { runHealthCheck } from './health.js';
import { offerBatchIngest } from './ingest.js';

function checkNodeVersion(): void {
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
  if (majorVersion >= 20) {
    console.log(`\u2713 Node.js ${nodeVersion}`);
  } else {
    console.log(`\u2717 Node.js ${nodeVersion} (requires 20+)`);
    process.exit(1);
  }
}

function createDirectoryStructure(causanticDir: string): void {
  const vectorsDir = path.join(causanticDir, 'vectors');

  for (const dir of [causanticDir, vectorsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`\u2713 Created ${dir}`);
    } else {
      console.log(`\u2713 Directory exists: ${dir}`);
    }
  }
}

function initializeDatabase(encryptionEnabled: boolean): void {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    console.log('\u2713 Database initialized' + (encryptionEnabled ? ' (encrypted)' : ''));
  } catch (error) {
    console.log(`\u2717 Database error: ${(error as Error).message}`);
    process.exit(1);
  }
}

export const initCommand: Command = {
  name: 'init',
  description: 'Initialize Causantic (setup wizard)',
  usage: 'causantic init [--skip-mcp] [--skip-encryption] [--skip-ingest]',
  handler: async (args) => {
    const skipMcp = args.includes('--skip-mcp');
    const skipEncryption = args.includes('--skip-encryption');
    const skipIngest = args.includes('--skip-ingest');

    console.log('Causantic - Setup');
    console.log('=================');
    console.log('');

    checkNodeVersion();

    const causanticDir = path.join(os.homedir(), '.causantic');
    createDirectoryStructure(causanticDir);

    let encryptionEnabled = false;
    if (!skipEncryption && process.stdin.isTTY) {
      encryptionEnabled = await setupEncryption(causanticDir);
    }

    initializeDatabase(encryptionEnabled);

    const claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
    const mcpConfigPath = path.join(os.homedir(), '.claude.json');
    console.log('');

    if (!skipMcp) {
      migrateMcpFromSettings(claudeConfigPath, mcpConfigPath);
      await configureMcp(mcpConfigPath);
      if (process.stdin.isTTY) {
        await patchProjectMcpFiles();
      }
      await installSkillsAndClaudeMd();
      await configureHooks(claudeConfigPath);
    }

    await runHealthCheck();

    if (!skipIngest && process.stdin.isTTY) {
      await offerBatchIngest();
    }

    console.log('');
    console.log('Setup complete!');
    console.log('');
    console.log('Next steps:');
    if (!skipIngest && process.stdin.isTTY) {
      console.log('  1. Restart Claude Code');
      console.log('  2. Ask Claude: "What did we work on recently?"');
    } else {
      console.log('  1. npx causantic batch-ingest ~/.claude/projects');
      console.log('  2. Restart Claude Code');
      console.log('  3. Ask Claude: "What did we work on recently?"');
    }
  },
};
