import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { promptYesNo } from '../../utils.js';
import { getCliEntryPath } from './shared.js';

/**
 * Migrate Causantic MCP entry from ~/.claude/settings.json to ~/.claude.json.
 * Claude Code reads MCP servers from ~/.claude.json, not settings.json.
 * This cleans up entries left by pre-0.5.0 installs.
 */
export function migrateMcpFromSettings(settingsPath: string, mcpConfigPath: string): void {
  try {
    if (!fs.existsSync(settingsPath)) return;

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const CAUSANTIC_SERVER_KEY = 'causantic';

    if (!settings.mcpServers?.[CAUSANTIC_SERVER_KEY]) return;

    // Check if already present in mcpConfigPath
    let mcpConfig: Record<string, unknown> = {};
    if (fs.existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      } catch {
        // Treat as empty if unparseable
      }
    }

    const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
    if (!mcpServers[CAUSANTIC_SERVER_KEY]) {
      mcpConfig.mcpServers = {
        ...mcpServers,
        [CAUSANTIC_SERVER_KEY]: settings.mcpServers[CAUSANTIC_SERVER_KEY],
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      console.log('\u2713 Migrated Causantic MCP config: settings.json \u2192 ~/.claude.json');
    }

    // Clean up old entry from settings.json
    delete settings.mcpServers[CAUSANTIC_SERVER_KEY];
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    // Best-effort migration
  }
}

export async function configureMcp(mcpConfigPath: string): Promise<void> {
  let config: Record<string, unknown>;

  if (!fs.existsSync(mcpConfigPath)) {
    config = { mcpServers: {} };
  } else {
    try {
      const configContent = fs.readFileSync(mcpConfigPath, 'utf-8');
      config = JSON.parse(configContent);
    } catch {
      console.log('\u26a0 Could not parse Claude Code MCP config');
      return;
    }
  }

  const CAUSANTIC_SERVER_KEY = 'causantic';
  const mcpServers = (config.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

  // Migrate old 'memory' key -> 'causantic'
  if (mcpServers.memory && !mcpServers[CAUSANTIC_SERVER_KEY]) {
    mcpServers[CAUSANTIC_SERVER_KEY] = mcpServers.memory;
    delete mcpServers.memory;
    config.mcpServers = mcpServers;
    fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
    console.log('\u2713 Migrated config: memory \u2192 causantic');
  }

  if (mcpServers[CAUSANTIC_SERVER_KEY]) {
    const existing = mcpServers[CAUSANTIC_SERVER_KEY];
    const expectedArgs = [getCliEntryPath(), 'serve'];
    const currentArgs = Array.isArray(existing.args) ? existing.args : [];
    const cliPathStale =
      currentArgs.length >= 1 &&
      currentArgs[0] !== expectedArgs[0] &&
      !fs.existsSync(currentArgs[0] as string);
    const usesNpx = existing.command === 'npx';

    if (usesNpx || cliPathStale) {
      mcpServers[CAUSANTIC_SERVER_KEY] = {
        command: process.execPath,
        args: expectedArgs,
      };
      config.mcpServers = mcpServers;
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
      if (cliPathStale) {
        console.log('\u2713 Updated Causantic config (CLI path was stale)');
      } else {
        console.log('\u2713 Updated Causantic config to use absolute paths');
      }
    } else {
      console.log('\u2713 Causantic already configured in Claude Code');
    }
  } else {
    if (await promptYesNo('Add Causantic to Claude Code MCP config?', true)) {
      mcpServers[CAUSANTIC_SERVER_KEY] = {
        command: process.execPath,
        args: [getCliEntryPath(), 'serve'],
      };
      config.mcpServers = mcpServers;
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
      console.log('\u2713 Added Causantic to Claude Code config');
      console.log(`  Node: ${process.execPath}`);
      console.log('  Restart Claude Code to activate');
    }
  }
}

export async function patchProjectMcpFiles(): Promise<void> {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeProjectsDir)) return;

  const serverConfig = {
    command: process.execPath,
    args: [getCliEntryPath(), 'serve'],
  };
  const CAUSANTIC_KEY = 'causantic';

  const projectsToFix: Array<{ name: string; mcpPath: string; needsMigrate: boolean }> = [];
  try {
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const projectPath = '/' + entry.name.replace(/^-/, '').replace(/-/g, '/');
      const mcpPath = path.join(projectPath, '.mcp.json');

      if (!fs.existsSync(mcpPath)) continue;

      try {
        const mcpContent = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        if (!mcpContent.mcpServers) continue;

        const readableName = projectPath.replace(
          new RegExp(`^/Users/${os.userInfo().username}/`),
          '~/',
        );
        if (mcpContent.mcpServers.memory && !mcpContent.mcpServers[CAUSANTIC_KEY]) {
          projectsToFix.push({ name: readableName, mcpPath, needsMigrate: true });
        } else if (!mcpContent.mcpServers[CAUSANTIC_KEY]) {
          projectsToFix.push({ name: readableName, mcpPath, needsMigrate: false });
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    return;
  }

  if (projectsToFix.length === 0) return;

  const migrateCount = projectsToFix.filter((p) => p.needsMigrate).length;
  const addCount = projectsToFix.length - migrateCount;
  console.log('');
  if (migrateCount > 0 && addCount > 0) {
    console.log(`Found ${addCount} project(s) missing Causantic and ${migrateCount} to migrate:`);
  } else if (migrateCount > 0) {
    console.log(`Found ${migrateCount} project(s) with old 'memory' key to migrate:`);
  } else {
    console.log(`Found ${addCount} project(s) with .mcp.json missing Causantic:`);
  }
  for (const p of projectsToFix) {
    console.log(`  ${p.name}${p.needsMigrate ? ' (migrate)' : ''}`);
  }

  if (!(await promptYesNo('Add/migrate Causantic server in these projects?', true))) return;

  let patched = 0;
  for (const p of projectsToFix) {
    try {
      const mcpContent = JSON.parse(fs.readFileSync(p.mcpPath, 'utf-8'));
      if (p.needsMigrate) {
        mcpContent.mcpServers[CAUSANTIC_KEY] = mcpContent.mcpServers.memory;
        delete mcpContent.mcpServers.memory;
      } else {
        mcpContent.mcpServers[CAUSANTIC_KEY] = serverConfig;
      }
      fs.writeFileSync(p.mcpPath, JSON.stringify(mcpContent, null, 2) + '\n');
      patched++;
    } catch {
      console.log(`  \u26a0 Could not patch ${p.name}`);
    }
  }
  if (patched > 0) {
    console.log(`\u2713 Updated Causantic in ${patched} project .mcp.json file(s)`);
  }
}
