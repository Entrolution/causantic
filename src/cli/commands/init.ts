import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Command } from '../types.js';
import { runTask } from '../../maintenance/scheduler.js';
import { getDb, storeDbKey } from '../../storage/db.js';
import { getChunkCount } from '../../storage/chunk-store.js';
import { createSecretStore } from '../../utils/secret-store.js';
import { promptPassword, promptYesNo, promptUser } from '../utils.js';

/** Resolve the CLI entry point path for MCP/hook configuration. */
function getCliEntryPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
}

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

async function setupEncryption(causanticDir: string): Promise<boolean> {
  const dbPath = path.join(causanticDir, 'memory.db');
  const existingDbExists = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;

  let existingDbIsUnencrypted = false;
  if (existingDbExists) {
    try {
      const Database = (await import('better-sqlite3-multiple-ciphers')).default;
      const testDb = new Database(dbPath);
      testDb.prepare('SELECT 1').get();
      testDb.close();
      existingDbIsUnencrypted = true;
    } catch {
      // DB exists but can't be opened without key — may already be encrypted
    }
  }

  console.log('');
  console.log('Enable database encryption?');
  console.log('Protects conversation data, embeddings, and work patterns.');

  if (existingDbIsUnencrypted) {
    console.log('');
    console.log('\u26a0  Existing unencrypted database detected.');
    console.log(
      '  Enabling encryption will back up the existing database and create a new encrypted one.',
    );
    console.log('  Your data will be migrated automatically.');
  }

  if (!(await promptYesNo('Enable encryption?'))) return false;

  const { generatePassword } = await import('../../storage/encryption.js');

  if (existingDbIsUnencrypted) {
    const backupPath = dbPath + '.unencrypted.bak';
    fs.copyFileSync(dbPath, backupPath);
    console.log(`\u2713 Backed up existing database to ${path.basename(backupPath)}`);
    fs.unlinkSync(dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    }
  }

  console.log('');
  console.log('Generating encryption key...');

  const key = generatePassword(32);
  await storeDbKey(key);

  const configPath = path.join(causanticDir, 'config.json');
  const existingConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...existingConfig,
        encryption: { enabled: true, cipher: 'chacha20', keySource: 'keychain' },
      },
      null,
      2,
    ),
  );

  console.log('\u2713 Key stored in system keychain');
  console.log('\u2713 Encryption enabled with ChaCha20-Poly1305');

  if (existingDbIsUnencrypted) {
    await migrateToEncryptedDb(dbPath);
  }

  return true;
}

async function migrateToEncryptedDb(dbPath: string): Promise<void> {
  const backupPath = dbPath + '.unencrypted.bak';
  try {
    const newDb = getDb();
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const oldDb = new Database(backupPath);

    // Skip schema_version (handled by migrations) and FTS5 shadow tables
    // (populated automatically via triggers when chunks are inserted)
    const tables = oldDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version' AND name NOT LIKE 'chunks_fts%'",
      )
      .all() as Array<{ name: string }>;

    let migratedRows = 0;
    for (const { name } of tables) {
      const exists = newDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name);
      if (!exists) continue;

      const rows = oldDb.prepare(`SELECT * FROM "${name}"`).all();
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = columns.map(() => '?').join(', ');
      const insert = newDb.prepare(
        `INSERT OR IGNORE INTO "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
      );

      const batchInsert = newDb.transaction((rowBatch: Array<Record<string, unknown>>) => {
        for (const row of rowBatch) {
          insert.run(...columns.map((c) => row[c]));
        }
      });
      batchInsert(rows as Array<Record<string, unknown>>);
      migratedRows += rows.length;
    }

    oldDb.close();
    console.log(`\u2713 Migrated ${migratedRows} rows to encrypted database`);
  } catch (err) {
    console.log(`\u26a0 Migration error: ${(err as Error).message}`);
    console.log(`  Backup preserved at: ${backupPath}`);
    console.log('  You can manually re-import with: causantic import');
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

/**
 * Migrate Causantic MCP entry from ~/.claude/settings.json to ~/.claude.json.
 * Claude Code reads MCP servers from ~/.claude.json, not settings.json.
 * This cleans up entries left by pre-0.5.0 installs.
 */
function migrateMcpFromSettings(settingsPath: string, mcpConfigPath: string): void {
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

async function configureMcp(mcpConfigPath: string): Promise<void> {
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

async function patchProjectMcpFiles(): Promise<void> {
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

async function installSkillsAndClaudeMd(): Promise<void> {
  const { CAUSANTIC_SKILLS, getMinimalClaudeMdBlock } = await import('../skill-templates.js');

  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  let skillsInstalled = 0;

  for (const skill of CAUSANTIC_SKILLS) {
    try {
      const skillDir = path.join(skillsDir, skill.dirName);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.content);
      skillsInstalled++;
    } catch {
      console.log(`\u26a0 Could not install skill: ${skill.dirName}`);
    }
  }

  if (skillsInstalled > 0) {
    console.log(`\u2713 Installed ${skillsInstalled} Causantic skills to ~/.claude/skills/`);
  }

  // Clean up removed skills (causantic-context merged into causantic-explain)
  const removedSkills = ['causantic-context'];
  for (const name of removedSkills) {
    const removedDir = path.join(skillsDir, name);
    if (fs.existsSync(removedDir)) {
      try {
        fs.rmSync(removedDir, { recursive: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  const CAUSANTIC_START = '<!-- CAUSANTIC_MEMORY_START -->';
  const CAUSANTIC_END = '<!-- CAUSANTIC_MEMORY_END -->';
  const memoryInstructions = getMinimalClaudeMdBlock();

  try {
    let claudeMd = '';
    if (fs.existsSync(claudeMdPath)) {
      claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
    }

    if (claudeMd.includes(CAUSANTIC_START)) {
      const startIdx = claudeMd.indexOf(CAUSANTIC_START);
      const endIdx = claudeMd.indexOf(CAUSANTIC_END);
      if (endIdx > startIdx) {
        claudeMd =
          claudeMd.slice(0, startIdx) +
          memoryInstructions +
          claudeMd.slice(endIdx + CAUSANTIC_END.length);
        fs.writeFileSync(claudeMdPath, claudeMd);
        console.log('\u2713 Updated CLAUDE.md with skill references');
      }
    } else {
      const separator = claudeMd.length > 0 && !claudeMd.endsWith('\n\n') ? '\n' : '';
      fs.writeFileSync(claudeMdPath, claudeMd + separator + memoryInstructions + '\n');
      console.log('\u2713 Added Causantic reference to CLAUDE.md');
    }
  } catch {
    console.log('\u26a0 Could not update CLAUDE.md');
  }
}

async function configureHooks(claudeConfigPath: string): Promise<void> {
  try {
    const settingsContent = fs.readFileSync(claudeConfigPath, 'utf-8');
    const config = JSON.parse(settingsContent);

    const cliEntry = getCliEntryPath();
    const nodeBin = process.execPath;

    const causanticHooks = [
      {
        event: 'PreCompact',
        matcher: '',
        hook: {
          type: 'command',
          command: `${nodeBin} ${cliEntry} hook pre-compact`,
          timeout: 300,
          async: true,
        },
      },
      {
        event: 'SessionStart',
        matcher: '',
        hook: {
          type: 'command',
          command: `${nodeBin} ${cliEntry} hook session-start`,
          timeout: 60,
        },
      },
      {
        event: 'SessionEnd',
        matcher: '',
        hook: {
          type: 'command',
          command: `${nodeBin} ${cliEntry} hook session-end`,
          timeout: 300,
          async: true,
        },
      },
      {
        event: 'SessionEnd',
        matcher: '',
        hook: {
          type: 'command',
          command: `${nodeBin} ${cliEntry} hook claudemd-generator`,
          timeout: 60,
          async: true,
        },
      },
    ];

    if (!config.hooks) {
      config.hooks = {};
    }

    // Extract the hook subcommand (e.g. "hook pre-compact") used to detect
    // existing entries regardless of the install path that preceded it.
    const hookSubcommand = (cmd: string): string => {
      const match = cmd.match(/hook\s+\S+/);
      return match ? match[0] : cmd;
    };

    let hooksChanged = 0;
    for (const { event, matcher, hook } of causanticHooks) {
      if (!config.hooks[event]) {
        config.hooks[event] = [];
      }

      const subCmd = hookSubcommand(hook.command);

      // Check if an identical entry already exists (same hook object).
      const hookStr = JSON.stringify(hook);
      const exactMatch = config.hooks[event].some(
        (entry: { hooks?: Array<Record<string, unknown>> }) =>
          entry.hooks?.some((h: Record<string, unknown>) => JSON.stringify(h) === hookStr),
      );

      if (exactMatch) continue;

      // Remove any stale entries for the same hook subcommand (e.g. from a
      // different install path) so we don't accumulate duplicates.
      config.hooks[event] = config.hooks[event].filter(
        (entry: { hooks?: Array<{ command?: string }> }) =>
          !entry.hooks?.some(
            (h: { command?: string }) => h.command && hookSubcommand(h.command) === subCmd,
          ),
      );

      config.hooks[event].push({
        matcher,
        hooks: [hook],
      });
      hooksChanged++;
    }

    if (hooksChanged > 0) {
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      const hookNames = causanticHooks.map((h) => h.event).join(', ');
      console.log(`\u2713 Configured ${hooksChanged} Claude Code hooks (${hookNames})`);
    } else {
      console.log('\u2713 Claude Code hooks already configured');
    }
  } catch {
    console.log('\u26a0 Could not configure Claude Code hooks');
  }
}

async function runHealthCheck(): Promise<void> {
  console.log('');
  console.log('Running health check...');

  try {
    const { vectorStore } = await import('../../storage/vector-store.js');
    if (vectorStore && typeof vectorStore.count === 'function') {
      await vectorStore.count();
    }
    console.log('\u2713 Vector store OK');
  } catch (error) {
    console.log(`\u26a0 Vector store: ${(error as Error).message}`);
  }
}

/** Create a terminal spinner for progress display. */
function createSpinner() {
  const frames = [
    '\u280b',
    '\u2819',
    '\u2839',
    '\u2838',
    '\u283c',
    '\u2834',
    '\u2826',
    '\u2827',
    '\u2807',
    '\u280f',
  ];
  let idx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let text = '';

  const writeLine = (line: string) => {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K' + line);
    }
  };

  return {
    start(label: string) {
      if (!process.stdout.isTTY) return;
      text = label;
      idx = 0;
      writeLine(`${frames[0]} ${text}`);
      timer = setInterval(() => {
        idx = (idx + 1) % frames.length;
        writeLine(`${frames[idx]} ${text}`);
      }, 80);
    },
    update(label: string) {
      text = label;
    },
    stop(doneText?: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write('\r\x1b[K');
      }
      if (doneText) {
        console.log(doneText);
      }
    },
  };
}

async function offerBatchIngest(): Promise<void> {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeProjectsDir)) return;

  console.log('');
  console.log('Existing Claude Code sessions found.');

  const projectDirs: Array<{ name: string; path: string; sessionCount: number }> = [];
  try {
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const projectPath = path.join(claudeProjectsDir, entry.name);
        const files = fs.readdirSync(projectPath);
        const sessionCount = files.filter(
          (f: string) =>
            f.endsWith('.jsonl') &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(f),
        ).length;
        if (sessionCount > 0) {
          const readableName = entry.name
            .replace(/^-/, '')
            .replace(/-/g, '/')
            .replace(/^Users\/[^/]+\//, '~/');
          projectDirs.push({ name: readableName, path: projectPath, sessionCount });
        }
      }
    }
  } catch {
    // Ignore errors reading projects
  }

  if (projectDirs.length === 0) return;

  projectDirs.sort((a, b) => b.sessionCount - a.sessionCount);

  const totalSessions = projectDirs.reduce((sum, p) => sum + p.sessionCount, 0);
  console.log(`Found ${projectDirs.length} projects with ${totalSessions} total sessions.`);
  console.log('');

  console.log('Import existing sessions?');
  console.log('  [A] All projects');
  console.log('  [S] Select specific projects');
  console.log('  [N] Skip (can run "causantic batch-ingest" later)');
  console.log('');

  const importChoice = (await promptUser('Choice [A/s/n]: ')).toLowerCase() || 'a';

  let projectsToIngest: string[] = [];

  if (importChoice === 'a' || importChoice === 'all') {
    projectsToIngest = projectDirs.map((p) => p.path);
  } else if (importChoice === 's' || importChoice === 'select') {
    console.log('');
    console.log('Select projects to import (comma-separated numbers, or "all"):');
    console.log('');
    projectDirs.forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.name} (${p.sessionCount} sessions)`);
    });
    console.log('');

    const selection = (await promptUser('Projects: ')).trim();

    if (selection.toLowerCase() === 'all') {
      projectsToIngest = projectDirs.map((p) => p.path);
    } else {
      const indices = selection.split(',').map((s) => parseInt(s.trim(), 10) - 1);
      for (const idx of indices) {
        if (idx >= 0 && idx < projectDirs.length) {
          projectsToIngest.push(projectDirs[idx].path);
        }
      }
    }
  } else {
    console.log('Skipping session import.');
  }

  if (projectsToIngest.length === 0) return;

  const spinner = createSpinner();

  const { detectDevice } = await import('../../models/device-detector.js');
  const { setLogLevel } = await import('../../utils/logger.js');
  const detectedDevice = detectDevice();
  console.log('');
  const availableHint = detectedDevice.available?.length
    ? ` (${detectedDevice.available.join(', ')} available)`
    : '';
  console.log(`\u2713 Inference: ${detectedDevice.label}${availableHint}`);
  console.log(`Importing ${projectsToIngest.length} project(s)...`);
  console.log('');

  setLogLevel('warn');

  const { discoverSessions, batchIngest } = await import('../../ingest/batch-ingest.js');
  const { Embedder } = await import('../../models/embedder.js');
  const { getModel } = await import('../../models/model-registry.js');

  const sharedEmbedder = new Embedder();
  await sharedEmbedder.load(getModel('jina-small'), { device: detectedDevice.device });

  let totalIngested = 0;
  let totalSkipped = 0;
  let totalChunks = 0;
  let totalEdges = 0;

  for (const projectPath of projectsToIngest) {
    const projectName = path
      .basename(projectPath)
      .replace(/^-/, '')
      .replace(/-/g, '/')
      .replace(/^Users\/[^/]+\//, '~/');

    const shortName = projectName.split('/').pop() || projectName;

    const sessions = await discoverSessions(projectPath);
    if (sessions.length === 0) {
      continue;
    }

    spinner.start(`${shortName}: 0/${sessions.length} sessions`);

    const result = await batchIngest(sessions, {
      embeddingDevice: detectedDevice.device,
      embedder: sharedEmbedder,
      progressCallback: (progress) => {
        spinner.update(
          `${shortName}: ${progress.done}/${progress.total} sessions, ${progress.totalChunks} chunks`,
        );
      },
    });

    spinner.stop();
    if (result.successCount > 0) {
      console.log(
        `  \u2713 ${shortName}: ${result.successCount} sessions, ${result.totalChunks} chunks, ${result.totalEdges} edges`,
      );
    } else if (result.skippedCount > 0) {
      console.log(`  \u2713 ${shortName}: ${result.skippedCount} sessions (already ingested)`);
    }

    totalIngested += result.successCount;
    totalSkipped += result.skippedCount;
    totalChunks += result.totalChunks;
    totalEdges += result.totalEdges;
  }

  await sharedEmbedder.dispose();
  setLogLevel('info');

  if (totalIngested === 0 && totalSkipped === 0) {
    console.log('  No sessions found to import.');
  } else if (totalIngested === 0) {
    console.log('');
    console.log(`\u2713 All ${totalSkipped} sessions already ingested`);
  } else {
    console.log('');
    const skippedSuffix = totalSkipped > 0 ? `, ${totalSkipped} skipped` : '';
    console.log(
      `\u2713 Total: ${totalIngested} sessions, ${totalChunks} chunks, ${totalEdges} edges${skippedSuffix}`,
    );
  }

  // Run post-ingestion maintenance tasks
  const existingChunks = getChunkCount();
  if (existingChunks > 0) {
    // Offer API key BEFORE clustering so labels can be generated in one pass
    await offerApiKeySetup();

    console.log('');
    console.log('Running post-ingestion processing...');

    const { setLogLevel: setPostLogLevel } = await import('../../utils/logger.js');
    setPostLogLevel('warn');

    spinner.start('Building clusters...');
    try {
      const clusterResult = await runTask('update-clusters');
      spinner.stop(
        clusterResult.success
          ? `  \u2713 ${clusterResult.message}`
          : `  \u26a0 Clustering: ${clusterResult.message}`,
      );
    } catch (err) {
      spinner.stop(`  \u2717 Clustering error: ${(err as Error).message}`);
    }

    setPostLogLevel('info');
  }
}

async function offerApiKeySetup(): Promise<void> {
  console.log('');
  console.log('Cluster labeling uses Claude Haiku to generate human-readable');
  console.log('descriptions for topic clusters.');

  if (!(await promptYesNo('Add Anthropic API key for cluster labeling?'))) return;

  const apiKey = await promptPassword('Enter Anthropic API key: ');

  if (apiKey && apiKey.startsWith('sk-ant-')) {
    const store = createSecretStore();
    await store.set('anthropic-api-key', apiKey);
    console.log('\u2713 API key stored in system keychain');

    // Set in env so update-clusters can use it for labeling
    process.env.ANTHROPIC_API_KEY = apiKey;
  } else if (apiKey) {
    console.log('\u26a0 Invalid API key format (should start with sk-ant-)');
    console.log('  You can add it later with: causantic config set-key anthropic-api-key');
  } else {
    console.log('  Skipping — clusters will be unlabeled.');
    console.log('  Add a key later with: causantic config set-key anthropic-api-key');
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
