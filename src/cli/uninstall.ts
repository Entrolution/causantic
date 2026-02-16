/**
 * Causantic Uninstall Command
 *
 * Removes all Causantic artifacts: integrations (CLAUDE.md, MCP config, skills, keychain)
 * and optionally the data directory (~/.causantic/).
 *
 * Usage: causantic uninstall [--force] [--keep-data] [--dry-run]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSecretStore } from '../utils/secret-store.js';
import { CAUSANTIC_SKILLS } from './skill-templates.js';
import { promptUser } from './utils.js';

const CAUSANTIC_SERVER_KEY = 'causantic';
const CAUSANTIC_START_MARKER = '<!-- CAUSANTIC_MEMORY_START -->';
const CAUSANTIC_END_MARKER = '<!-- CAUSANTIC_MEMORY_END -->';

const KEYCHAIN_KEYS = ['causantic-db-key', 'anthropic-api-key'];

/** A single artifact that can be removed */
export interface RemovalArtifact {
  label: string;
  description: string;
  category: 'integration' | 'secret' | 'data';
  found: boolean;
  /** Human-readable size (only for data category) */
  size?: string;
  /** Removal function — returns true if successfully removed */
  remove: () => Promise<boolean>;
  /** Verification function — returns true if artifact is still present */
  verify: () => boolean;
}

/** Get recursive directory size in bytes */
export function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(fullPath).size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return total;
}

/** Format bytes as human-readable string */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Remove Causantic block from CLAUDE.md content.
 * Returns the cleaned content, or null if no Causantic block was found.
 */
export function removeCausanticBlock(content: string): string | null {
  const startIdx = content.indexOf(CAUSANTIC_START_MARKER);
  const endIdx = content.indexOf(CAUSANTIC_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return null;
  }

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + CAUSANTIC_END_MARKER.length);

  // Clean up extra blank lines at the splice point
  let result = before.replace(/\n{2,}$/, '\n') + after.replace(/^\n{2,}/, '\n');

  // Trim trailing whitespace but keep a final newline
  result = result.replace(/\s+$/, '') + '\n';

  // If the file is now empty (just whitespace), return empty string
  if (result.trim() === '') {
    result = '';
  }

  return result;
}

/**
 * Remove a JSON key from a config file.
 * Returns true if the key was found and removed.
 */
export function removeJsonKey(filePath: string, keyPath: string[]): boolean {
  if (!fs.existsSync(filePath)) return false;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    // Navigate to parent of the target key
    let parent = json;
    for (let i = 0; i < keyPath.length - 1; i++) {
      if (parent === null || parent === undefined || typeof parent !== 'object') return false;
      parent = parent[keyPath[i]];
    }

    const targetKey = keyPath[keyPath.length - 1];
    if (
      parent === null ||
      parent === undefined ||
      typeof parent !== 'object' ||
      !(targetKey in parent)
    ) {
      return false;
    }

    delete parent[targetKey];
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a Claude projects directory name back to a filesystem path.
 * e.g., "-Users-gvn-Dev-Foo" → "/Users/gvn/Dev/Foo"
 */
export function decodeProjectDirName(dirName: string): string {
  return '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
}

/**
 * Discover project .mcp.json files that contain the Causantic server entry.
 * Returns array of { displayName, mcpPath }.
 */
export function discoverProjectMcpFiles(): Array<{ displayName: string; mcpPath: string }> {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const results: Array<{ displayName: string; mcpPath: string }> = [];

  if (!fs.existsSync(claudeProjectsDir)) return results;

  try {
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const projectPath = decodeProjectDirName(entry.name);
      const mcpPath = path.join(projectPath, '.mcp.json');

      if (!fs.existsSync(mcpPath)) continue;

      try {
        const mcpContent = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        if (mcpContent.mcpServers?.[CAUSANTIC_SERVER_KEY]) {
          const displayName = projectPath.replace(
            new RegExp(`^/Users/${os.userInfo().username}/`),
            '~/',
          );
          results.push({ displayName, mcpPath });
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Skip if can't read projects dir
  }

  return results;
}

/** Check if settings.json hooks contain any causantic entries. */
function settingsHaveCausanticHooks(settingsPath: string): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (!config.hooks) return false;
    for (const event of Object.keys(config.hooks)) {
      const entries = config.hooks[event];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry.hooks?.some((h: { command?: string }) => h.command?.includes('causantic'))) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function findClaudeMdArtifact(): RemovalArtifact {
  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  let found = false;
  try {
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    found = content.includes(CAUSANTIC_START_MARKER) && content.includes(CAUSANTIC_END_MARKER);
  } catch {
    // File doesn't exist or can't be read
  }

  return {
    label: '~/.claude/CLAUDE.md',
    description: 'Causantic memory block',
    category: 'integration',
    found,
    remove: async () => {
      try {
        const content = fs.readFileSync(claudeMdPath, 'utf-8');
        const cleaned = removeCausanticBlock(content);
        if (cleaned === null) return false;
        fs.writeFileSync(claudeMdPath, cleaned === '' ? '' : cleaned);
        return true;
      } catch {
        return false;
      }
    },
    verify: () => {
      try {
        return fs.readFileSync(claudeMdPath, 'utf-8').includes(CAUSANTIC_START_MARKER);
      } catch {
        return false;
      }
    },
  };
}

function findMcpConfigArtifact(): RemovalArtifact {
  const mcpConfigPath = path.join(os.homedir(), '.claude.json');
  let found = false;
  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    found = CAUSANTIC_SERVER_KEY in (config.mcpServers ?? {});
  } catch {
    // File doesn't exist or can't be read
  }

  return {
    label: '~/.claude.json',
    description: 'MCP server entry',
    category: 'integration',
    found,
    remove: async () => removeJsonKey(mcpConfigPath, ['mcpServers', CAUSANTIC_SERVER_KEY]),
    verify: () => {
      try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
        return CAUSANTIC_SERVER_KEY in (config.mcpServers ?? {});
      } catch {
        return false;
      }
    },
  };
}

/** Check for legacy MCP entries left by pre-0.5.0 installs in settings.json. */
function findLegacyMcpConfigArtifact(): RemovalArtifact {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let found = false;
  try {
    const config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    found = CAUSANTIC_SERVER_KEY in (config.mcpServers ?? {});
  } catch {
    // File doesn't exist or can't be read
  }

  return {
    label: '~/.claude/settings.json',
    description: 'Legacy MCP server entry',
    category: 'integration',
    found,
    remove: async () => removeJsonKey(settingsPath, ['mcpServers', CAUSANTIC_SERVER_KEY]),
    verify: () => {
      try {
        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return CAUSANTIC_SERVER_KEY in (config.mcpServers ?? {});
      } catch {
        return false;
      }
    },
  };
}

function findHooksArtifact(): RemovalArtifact {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  return {
    label: '~/.claude/settings.json',
    description: 'Claude Code hooks',
    category: 'integration',
    found: settingsHaveCausanticHooks(settingsPath),
    remove: async () => {
      try {
        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (!config.hooks) return false;
        let removed = false;
        for (const event of Object.keys(config.hooks)) {
          const entries = config.hooks[event];
          if (!Array.isArray(entries)) continue;
          config.hooks[event] = entries.filter(
            (entry: { hooks?: Array<{ command?: string }> }) =>
              !entry.hooks?.some((h: { command?: string }) => h.command?.includes('causantic')),
          );
          if (config.hooks[event].length !== entries.length) {
            removed = true;
          }
          if (config.hooks[event].length === 0) {
            delete config.hooks[event];
          }
        }
        if (Object.keys(config.hooks).length === 0) {
          delete config.hooks;
        }
        if (removed) {
          fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n');
        }
        return removed;
      } catch {
        return false;
      }
    },
    verify: () => settingsHaveCausanticHooks(settingsPath),
  };
}

function findProjectMcpArtifacts(): RemovalArtifact[] {
  return discoverProjectMcpFiles().map(({ displayName, mcpPath }) => ({
    label: displayName + '/.mcp.json',
    description: 'MCP server entry',
    category: 'integration' as const,
    found: true,
    remove: async () => removeJsonKey(mcpPath, ['mcpServers', CAUSANTIC_SERVER_KEY]),
    verify: () => {
      try {
        const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        return CAUSANTIC_SERVER_KEY in (config.mcpServers ?? {});
      } catch {
        return false;
      }
    },
  }));
}

function findSkillArtifacts(): RemovalArtifact[] {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');

  return CAUSANTIC_SKILLS.map((skill) => {
    const skillDir = path.join(skillsDir, skill.dirName);
    return {
      label: `~/.claude/skills/${skill.dirName}/`,
      description: 'Skill directory',
      category: 'integration' as const,
      found: fs.existsSync(skillDir),
      remove: async () => {
        try {
          fs.rmSync(skillDir, { recursive: true, force: true });
          return true;
        } catch {
          return false;
        }
      },
      verify: () => fs.existsSync(skillDir),
    };
  });
}

function findKeychainArtifacts(): RemovalArtifact[] {
  return KEYCHAIN_KEYS.map((keyName) => ({
    label: `Keychain: ${keyName}`,
    description: '',
    category: 'secret' as const,
    found: true, // Can't cheaply check if keychain entries exist without side effects
    remove: async () => {
      try {
        const store = createSecretStore();
        return await store.delete(keyName);
      } catch {
        return false;
      }
    },
    verify: () => false, // Can't cheaply verify keychain state synchronously
  }));
}

function findDataArtifact(): RemovalArtifact {
  const causanticDir = path.join(os.homedir(), '.causantic');
  const exists = fs.existsSync(causanticDir);
  const dirSize = exists ? getDirSize(causanticDir) : 0;

  return {
    label: '~/.causantic/',
    description: formatSize(dirSize),
    category: 'data',
    found: exists,
    size: formatSize(dirSize),
    remove: async () => {
      try {
        fs.rmSync(causanticDir, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
    verify: () => fs.existsSync(causanticDir),
  };
}

/**
 * Build the full removal plan by scanning all artifact locations.
 */
export function buildRemovalPlan(keepData: boolean): RemovalArtifact[] {
  const artifacts: RemovalArtifact[] = [
    findClaudeMdArtifact(),
    findMcpConfigArtifact(),
    findLegacyMcpConfigArtifact(),
    findHooksArtifact(),
    ...findProjectMcpArtifacts(),
    ...findSkillArtifacts(),
    ...findKeychainArtifacts(),
  ];

  if (!keepData) {
    artifacts.push(findDataArtifact());
  }

  return artifacts;
}

/**
 * Print the removal preview.
 */
export function printPreview(artifacts: RemovalArtifact[], keepData: boolean): void {
  console.log('');
  console.log('Causantic Uninstall Preview');
  console.log('');

  const integrations = artifacts.filter((a) => a.category === 'integration');
  const secrets = artifacts.filter((a) => a.category === 'secret');
  const data = artifacts.filter((a) => a.category === 'data');

  if (integrations.length > 0) {
    console.log('  Integrations:');
    for (const a of integrations) {
      const status = a.found ? '\u2713' : '\u2717';
      const suffix = a.description ? `  ${a.description}` : '';
      console.log(`    ${status} ${a.label.padEnd(45)}${suffix}`);
    }
    console.log('');
  }

  if (secrets.length > 0) {
    console.log('  Secrets:');
    for (const a of secrets) {
      console.log(`    \u2713 ${a.label}`);
    }
    console.log('');
  }

  if (data.length > 0) {
    console.log('  Data:');
    for (const a of data) {
      const status = a.found ? '\u2713' : '\u2717';
      const suffix = a.description ? `  ${a.description}` : '';
      console.log(`    ${status} ${a.label.padEnd(45)}${suffix}`);
    }
    console.log('');
  }

  if (keepData) {
    console.log('  Note: --keep-data specified; ~/.causantic/ will be preserved.');
    console.log('');
  }
}

/**
 * Run the post-removal verification sweep.
 * Returns list of artifacts that are still present.
 */
export function verifyRemoval(artifacts: RemovalArtifact[]): string[] {
  const leftovers: string[] = [];
  for (const a of artifacts) {
    if (a.verify()) {
      leftovers.push(a.label);
    }
  }
  return leftovers;
}

/**
 * Main uninstall handler.
 */
export async function handleUninstall(args: string[]): Promise<void> {
  const force = args.includes('--force');
  const keepData = args.includes('--keep-data');
  const dryRun = args.includes('--dry-run');

  // 1. Build removal plan
  const artifacts = buildRemovalPlan(keepData);
  const foundArtifacts = artifacts.filter((a) => a.found);

  if (foundArtifacts.length === 0) {
    console.log('Nothing to uninstall — no Causantic artifacts found.');
    return;
  }

  // 2. Display preview
  printPreview(artifacts, keepData);

  // 3. If --dry-run, exit
  if (dryRun) {
    console.log('Dry run — no changes made.');
    return;
  }

  // 4. If not --force and not --keep-data, suggest export
  if (!force && !keepData) {
    console.log(
      'Back up your data first? Run: causantic export --output ~/causantic-backup.causantic',
    );
    console.log('');
  }

  // 5. If not --force, require confirmation
  if (!force) {
    if (!process.stdin.isTTY) {
      console.error('Cannot prompt for confirmation in non-interactive mode. Use --force to skip.');
      process.exit(1);
    }

    const answer = (await promptUser('Type "yes" to proceed with uninstall: ')).trim();

    if (answer !== 'yes') {
      console.log('Uninstall cancelled.');
      return;
    }

    console.log('');
  }

  // 6. Execute removal
  console.log('Removing Causantic artifacts...');
  console.log('');

  for (const artifact of artifacts) {
    if (!artifact.found) continue;

    const success = await artifact.remove();
    const status = success ? '\u2713' : '\u2717';
    console.log(`  ${status} ${artifact.label}`);
  }

  console.log('');

  // 7. Post-removal verification
  const leftovers = verifyRemoval(artifacts);
  if (leftovers.length > 0) {
    console.log('Warning: Some artifacts could not be removed:');
    for (const label of leftovers) {
      console.log(`  - ${label}`);
    }
    console.log('');
  } else {
    console.log('Clean! All Causantic artifacts removed.');
    console.log('');
  }

  // 8. Reinstall hint
  console.log('To reinstall: npx causantic init');
}
