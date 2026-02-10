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

/** Magic bytes for encrypted archives */
const ENCRYPTED_MAGIC = Buffer.from('ECM\x00');

/**
 * Prompt for password with hidden input.
 * Falls back to visible input if raw mode is not available.
 */
async function promptPassword(prompt: string): Promise<string> {
  const readline = await import('node:readline');

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Check if we can use raw mode for hidden input
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let password = '';
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode!(false);
          process.stdin.removeListener('data', onData);
          process.stdin.pause();
          console.log(''); // newline
          rl.close();
          resolve(password);
        } else if (c === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode!(false);
          process.exit(0);
        } else if (c === '\u007F' || c === '\b') {
          // Backspace
          password = password.slice(0, -1);
        } else if (c.charCodeAt(0) >= 32) {
          // Printable character
          password += c;
        }
      };
      process.stdin.on('data', onData);
    } else {
      // Fallback to visible input (non-TTY environments)
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Check if a file is an encrypted ECM archive.
 */
async function isEncryptedArchive(filePath: string): Promise<boolean> {
  const fs = await import('node:fs');
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    return header.equals(ENCRYPTED_MAGIC);
  } catch {
    return false;
  }
}

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
    usage: 'ecm init [--skip-mcp] [--skip-encryption] [--skip-ingest]',
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

      // Step 3: Ask about encryption (before database init)
      const skipEncryption = args.includes('--skip-encryption');
      let encryptionEnabled = false;

      if (!skipEncryption && process.stdin.isTTY) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        console.log('');
        console.log('Enable database encryption?');
        console.log('Protects conversation data, embeddings, and work patterns.');

        const encryptAnswer = await new Promise<string>((resolve) => {
          rl.question('[y/N] ', (ans) => {
            rl.close();
            resolve(ans.toLowerCase() || 'n');
          });
        });

        if (encryptAnswer === 'y' || encryptAnswer === 'yes') {
          const { generatePassword } = await import('../storage/encryption.js');
          const { storeDbKey } = await import('../storage/db.js');

          console.log('');
          console.log('Generating encryption key...');

          const key = generatePassword(32);
          await storeDbKey(key);

          // Write config with encryption enabled
          const configPath = path.join(ecmDir, 'config.json');
          const encryptionConfig = {
            encryption: {
              enabled: true,
              cipher: 'chacha20',
              keySource: 'keychain',
            },
          };
          fs.writeFileSync(configPath, JSON.stringify(encryptionConfig, null, 2));

          console.log('✓ Key stored in system keychain');
          console.log('✓ Encryption enabled with ChaCha20-Poly1305');
          encryptionEnabled = true;
        }
      }

      // Step 4: Initialize database
      try {
        const db = getDb();
        db.prepare('SELECT 1').get();
        console.log('✓ Database initialized' + (encryptionEnabled ? ' (encrypted)' : ''));
      } catch (error) {
        console.log(`✗ Database error: ${(error as Error).message}`);
        process.exit(1);
      }

      // Step 5: Detect Claude Code config path
      // Claude Code uses ~/.claude/settings.json (cross-platform)
      const claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');

      console.log('');
      console.log(`Claude Code config: ${claudeConfigPath}`);

      // Step 6: Offer to configure MCP
      if (!skipMcp) {
        const configExists = fs.existsSync(claudeConfigPath);

        if (configExists) {
          console.log('✓ Claude Code config found');

          try {
            const configContent = fs.readFileSync(claudeConfigPath, 'utf-8');
            const config = JSON.parse(configContent);

            const ECM_SERVER_KEY = 'entropic-causal-memory';

            // Migrate old 'memory' key → 'entropic-causal-memory'
            if (config.mcpServers?.memory && !config.mcpServers[ECM_SERVER_KEY]) {
              config.mcpServers[ECM_SERVER_KEY] = config.mcpServers.memory;
              delete config.mcpServers.memory;
              fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
              console.log('✓ Migrated ECM config: memory → entropic-causal-memory');
            }

            if (config.mcpServers?.[ECM_SERVER_KEY]) {
              // Check if using npx (broken with nvm) and offer to fix
              if (config.mcpServers[ECM_SERVER_KEY].command === 'npx') {
                const nodeBin = process.execPath;
                const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/index.js';

                config.mcpServers[ECM_SERVER_KEY] = {
                  command: nodeBin,
                  args: [cliEntry, 'serve'],
                };
                fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
                console.log('✓ Updated ECM config to use absolute paths');
              } else {
                console.log('✓ ECM already configured in Claude Code');
              }
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
                // Use absolute paths to avoid nvm/fnm shell wrapper issues
                const nodeBin = process.execPath;
                const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/index.js';

                config.mcpServers = config.mcpServers || {};
                config.mcpServers[ECM_SERVER_KEY] = {
                  command: nodeBin,
                  args: [cliEntry, 'serve'],
                };
                fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
                console.log('✓ Added ECM to Claude Code config');
                console.log(`  Node: ${nodeBin}`);
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

      // Step 6b: Patch project-level .mcp.json files
      // Claude Code projects with their own .mcp.json don't inherit global mcpServers,
      // so ECM must be added to each project's .mcp.json individually.
      if (!skipMcp && process.stdin.isTTY) {
        const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
        if (fs.existsSync(claudeProjectsDir)) {
          const nodeBin = process.execPath;
          const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/index.js';
          const memoryServerConfig = {
            command: nodeBin,
            args: [cliEntry, 'serve'],
          };

          const ECM_KEY = 'entropic-causal-memory';

          // Find project dirs that have .mcp.json but no ECM server (or old 'memory' key)
          const projectsToFix: Array<{ name: string; mcpPath: string; needsMigrate: boolean }> = [];
          try {
            const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

              // Decode project path from dir name: -Users-gvn-Dev-Foo → /Users/gvn/Dev/Foo
              const projectPath = '/' + entry.name.replace(/^-/, '').replace(/-/g, '/');
              const mcpPath = path.join(projectPath, '.mcp.json');

              if (!fs.existsSync(mcpPath)) continue;

              try {
                const mcpContent = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
                if (!mcpContent.mcpServers) continue;

                if (mcpContent.mcpServers.memory && !mcpContent.mcpServers[ECM_KEY]) {
                  // Has old 'memory' key, needs migration
                  const readableName = projectPath.replace(new RegExp(`^/Users/${os.userInfo().username}/`), '~/');
                  projectsToFix.push({ name: readableName, mcpPath, needsMigrate: true });
                } else if (!mcpContent.mcpServers[ECM_KEY]) {
                  // Missing entirely
                  const readableName = projectPath.replace(new RegExp(`^/Users/${os.userInfo().username}/`), '~/');
                  projectsToFix.push({ name: readableName, mcpPath, needsMigrate: false });
                }
              } catch {
                // Skip unparseable files
              }
            }
          } catch {
            // Skip if can't read projects dir
          }

          if (projectsToFix.length > 0) {
            const migrateCount = projectsToFix.filter((p) => p.needsMigrate).length;
            const addCount = projectsToFix.length - migrateCount;
            console.log('');
            if (migrateCount > 0 && addCount > 0) {
              console.log(`Found ${addCount} project(s) missing ECM and ${migrateCount} to migrate:`);
            } else if (migrateCount > 0) {
              console.log(`Found ${migrateCount} project(s) with old 'memory' key to migrate:`);
            } else {
              console.log(`Found ${addCount} project(s) with .mcp.json missing ECM:`);
            }
            for (const p of projectsToFix) {
              console.log(`  ${p.name}${p.needsMigrate ? ' (migrate)' : ''}`);
            }

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const fixAnswer = await new Promise<string>((resolve) => {
              rl.question('Add/migrate ECM server in these projects? [Y/n] ', (ans) => {
                rl.close();
                resolve(ans.toLowerCase() || 'y');
              });
            });

            if (fixAnswer === 'y' || fixAnswer === 'yes') {
              let patched = 0;
              for (const p of projectsToFix) {
                try {
                  const mcpContent = JSON.parse(fs.readFileSync(p.mcpPath, 'utf-8'));
                  if (p.needsMigrate) {
                    mcpContent.mcpServers[ECM_KEY] = mcpContent.mcpServers.memory;
                    delete mcpContent.mcpServers.memory;
                  } else {
                    mcpContent.mcpServers[ECM_KEY] = memoryServerConfig;
                  }
                  fs.writeFileSync(p.mcpPath, JSON.stringify(mcpContent, null, 2) + '\n');
                  patched++;
                } catch {
                  console.log(`  ⚠ Could not patch ${p.name}`);
                }
              }
              if (patched > 0) {
                console.log(`✓ Updated ECM in ${patched} project .mcp.json file(s)`);
              }
            }
          }
        }
      }

      // Step 6c: Install ECM skills and update CLAUDE.md reference
      if (!skipMcp) {
        const { ECM_SKILLS, getMinimalClaudeMdBlock } = await import('./skill-templates.js');

        // Install skill files to ~/.claude/skills/ecm-*/SKILL.md
        const skillsDir = path.join(os.homedir(), '.claude', 'skills');
        let skillsInstalled = 0;

        for (const skill of ECM_SKILLS) {
          try {
            const skillDir = path.join(skillsDir, skill.dirName);
            if (!fs.existsSync(skillDir)) {
              fs.mkdirSync(skillDir, { recursive: true });
            }
            const skillPath = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillPath, skill.content);
            skillsInstalled++;
          } catch {
            console.log(`⚠ Could not install skill: ${skill.dirName}`);
          }
        }

        if (skillsInstalled > 0) {
          console.log(`✓ Installed ${skillsInstalled} ECM skills to ~/.claude/skills/`);
        }

        // Update CLAUDE.md with minimal reference (detailed instructions now in skills)
        const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
        const ECM_START = '<!-- ECM_MEMORY_START -->';
        const ECM_END = '<!-- ECM_MEMORY_END -->';
        const memoryInstructions = getMinimalClaudeMdBlock();

        try {
          let claudeMd = '';
          if (fs.existsSync(claudeMdPath)) {
            claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
          }

          if (claudeMd.includes(ECM_START)) {
            // Replace existing section with minimal version
            const startIdx = claudeMd.indexOf(ECM_START);
            const endIdx = claudeMd.indexOf(ECM_END);
            if (endIdx > startIdx) {
              claudeMd = claudeMd.slice(0, startIdx) + memoryInstructions + claudeMd.slice(endIdx + ECM_END.length);
              fs.writeFileSync(claudeMdPath, claudeMd);
              console.log('✓ Updated CLAUDE.md with skill references');
            }
          } else {
            // Append to file
            const separator = claudeMd.length > 0 && !claudeMd.endsWith('\n\n') ? '\n' : '';
            fs.writeFileSync(claudeMdPath, claudeMd + separator + memoryInstructions + '\n');
            console.log('✓ Added ECM reference to CLAUDE.md');
          }
        } catch {
          console.log('⚠ Could not update CLAUDE.md');
        }
      }

      // Step 7: Health check
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

      // Step 8: Offer to ingest existing Claude sessions
      const skipIngest = args.includes('--skip-ingest');
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

      if (!skipIngest && process.stdin.isTTY && fs.existsSync(claudeProjectsDir)) {
        console.log('');
        console.log('Existing Claude Code sessions found.');

        // Discover projects
        const projectDirs: Array<{ name: string; path: string; sessionCount: number }> = [];
        try {
          const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const projectPath = path.join(claudeProjectsDir, entry.name);
              // Count session files
              const files = fs.readdirSync(projectPath);
              const sessionCount = files.filter((f: string) =>
                f.endsWith('.jsonl') &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(f)
              ).length;
              if (sessionCount > 0) {
                // Convert path format to readable name
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

        if (projectDirs.length > 0) {
          // Sort by session count descending
          projectDirs.sort((a, b) => b.sessionCount - a.sessionCount);

          const totalSessions = projectDirs.reduce((sum, p) => sum + p.sessionCount, 0);
          console.log(`Found ${projectDirs.length} projects with ${totalSessions} total sessions.`);
          console.log('');

          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          console.log('Import existing sessions?');
          console.log('  [A] All projects');
          console.log('  [S] Select specific projects');
          console.log('  [N] Skip (can run "ecm batch-ingest" later)');
          console.log('');

          const importChoice = await new Promise<string>((resolve) => {
            rl.question('Choice [A/s/n]: ', (ans) => {
              resolve(ans.toLowerCase() || 'a');
            });
          });

          let projectsToIngest: string[] = [];

          if (importChoice === 'a' || importChoice === 'all') {
            projectsToIngest = projectDirs.map((p) => p.path);
            rl.close();
          } else if (importChoice === 's' || importChoice === 'select') {
            console.log('');
            console.log('Select projects to import (comma-separated numbers, or "all"):');
            console.log('');
            projectDirs.forEach((p, i) => {
              console.log(`  [${i + 1}] ${p.name} (${p.sessionCount} sessions)`);
            });
            console.log('');

            const selection = await new Promise<string>((resolve) => {
              rl.question('Projects: ', (ans) => {
                rl.close();
                resolve(ans.trim());
              });
            });

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
            rl.close();
            console.log('Skipping session import.');
          }

          // Spinner utilities for progress display
          const spinFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
          let spinIdx = 0;
          let spinTimer: ReturnType<typeof setInterval> | null = null;
          let currentSpinText = '';

          const writeLine = (text: string) => {
            if (process.stdout.isTTY) {
              process.stdout.write('\r\x1b[K' + text);
            }
          };

          const startSpinner = (text: string) => {
            if (!process.stdout.isTTY) return;
            currentSpinText = text;
            spinIdx = 0;
            writeLine(`${spinFrames[0]} ${currentSpinText}`);
            spinTimer = setInterval(() => {
              spinIdx = (spinIdx + 1) % spinFrames.length;
              writeLine(`${spinFrames[spinIdx]} ${currentSpinText}`);
            }, 80);
          };

          const stopSpinner = (doneText?: string) => {
            if (spinTimer) {
              clearInterval(spinTimer);
              spinTimer = null;
            }
            if (process.stdout.isTTY) {
              process.stdout.write('\r\x1b[K');
            }
            if (doneText) {
              console.log(doneText);
            }
          };

          if (projectsToIngest.length > 0) {
            const { detectDevice } = await import('../models/device-detector.js');
            const { setLogLevel } = await import('../utils/logger.js');
            const detectedDevice = detectDevice();
            console.log('');
            const availableHint = detectedDevice.available?.length
              ? ` (${detectedDevice.available.join(', ')} available)`
              : '';
            console.log(`\u2713 Inference: ${detectedDevice.label}${availableHint}`);
            console.log(`Importing ${projectsToIngest.length} project(s)...`);
            console.log('');

            // Suppress info logs during ingestion to avoid polluting spinner display
            setLogLevel('warn');

            const { discoverSessions, batchIngest } = await import('../ingest/batch-ingest.js');
            const { Embedder } = await import('../models/embedder.js');
            const { getModel } = await import('../models/model-registry.js');

            // Single shared embedder across all projects
            const sharedEmbedder = new Embedder();
            await sharedEmbedder.load(getModel('jina-small'), { device: detectedDevice.device });

            let totalIngested = 0;
            let totalSkipped = 0;
            let totalChunks = 0;
            let totalEdges = 0;

            // Process each project individually for better progress display
            for (const projectPath of projectsToIngest) {
              const projectName = path.basename(projectPath)
                .replace(/^-/, '')
                .replace(/-/g, '/')
                .replace(/^Users\/[^/]+\//, '~/');

              // Get short name for display (last path component)
              const shortName = projectName.split('/').pop() || projectName;

              const sessions = await discoverSessions(projectPath);
              if (sessions.length === 0) {
                continue;
              }

              startSpinner(`${shortName}: 0/${sessions.length} sessions`);

              const result = await batchIngest(sessions, {
                embeddingDevice: detectedDevice.device,
                embedder: sharedEmbedder,
                progressCallback: (progress) => {
                  currentSpinText = `${shortName}: ${progress.done}/${progress.total} sessions, ${progress.totalChunks} chunks`;
                },
              });

              stopSpinner();
              if (result.successCount > 0) {
                console.log(`  \u2713 ${shortName}: ${result.successCount} sessions, ${result.totalChunks} chunks, ${result.totalEdges} edges`);
              } else if (result.skippedCount > 0) {
                console.log(`  \u2713 ${shortName}: ${result.skippedCount} sessions (already ingested)`);
              }

              totalIngested += result.successCount;
              totalSkipped += result.skippedCount;
              totalChunks += result.totalChunks;
              totalEdges += result.totalEdges;
            }

            // Clean up shared embedder and restore log level
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
              console.log(`\u2713 Total: ${totalIngested} sessions, ${totalChunks} chunks, ${totalEdges} edges${skippedSuffix}`);
            }

            // Run post-ingestion maintenance tasks if there are chunks in the DB
            // (either newly created or from a previous ingestion)
            const existingChunks = getChunkCount();
            if (existingChunks > 0) {
              console.log('');
              console.log('Running post-ingestion processing...');

              // Suppress logs during post-processing to keep spinner clean
              const { setLogLevel: setPostLogLevel } = await import('../utils/logger.js');
              setPostLogLevel('warn');

              // Graph pruning first (removes dead edges and orphan nodes)
              startSpinner('Pruning graph...');
              try {
                const pruneResult = await runTask('prune-graph');
                stopSpinner(pruneResult.success
                  ? '  \u2713 Graph pruned'
                  : `  \u26a0 Pruning: ${pruneResult.message}`);
              } catch (err) {
                stopSpinner(`  \u2717 Pruning error: ${(err as Error).message}`);
              }

              // Clustering (groups chunks by topic)
              startSpinner('Building clusters...');
              try {
                const clusterResult = await runTask('update-clusters');
                stopSpinner(clusterResult.success
                  ? '  \u2713 Clusters built'
                  : `  \u26a0 Clustering: ${clusterResult.message}`);
              } catch (err) {
                stopSpinner(`  \u2717 Clustering error: ${(err as Error).message}`);
              }

              // Ask about Claude API key for cluster labeling
              console.log('');
              console.log('Cluster labeling uses Claude Haiku to generate human-readable');
              console.log('descriptions for topic clusters.');

              const apiKeyRl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
              });

              const wantsLabeling = await new Promise<string>((resolve) => {
                apiKeyRl.question('Add Anthropic API key for cluster labeling? [y/N] ', (ans) => {
                  resolve(ans.toLowerCase() || 'n');
                });
              });
              apiKeyRl.close();

              if (wantsLabeling === 'y' || wantsLabeling === 'yes') {
                const apiKey = await promptPassword('Enter Anthropic API key: ');

                if (apiKey && apiKey.startsWith('sk-ant-')) {
                  // Store in keychain
                  const store = createSecretStore();
                  await store.set('anthropic-api-key', apiKey);
                  console.log('✓ API key stored in system keychain');

                  // Set environment variable for the current process and run labeling
                  process.env.ANTHROPIC_API_KEY = apiKey;

                  startSpinner('Labeling clusters...');
                  try {
                    const labelResult = await runTask('refresh-labels');
                    stopSpinner(labelResult.success
                      ? '  \u2713 Clusters labeled'
                      : `  \u26a0 Labeling: ${labelResult.message}`);
                  } catch (err) {
                    stopSpinner(`  \u2717 Labeling error: ${(err as Error).message}`);
                  }
                } else if (apiKey) {
                  console.log('⚠ Invalid API key format (should start with sk-ant-)');
                  console.log('  You can add it later with: ecm config set-key anthropic-api-key');
                } else {
                  console.log('  Skipping cluster labeling.');
                }
              }

              setPostLogLevel('info');
            }
          }
        }
      }

      console.log('');
      console.log('Setup complete!');
      console.log('');
      console.log('Next steps:');
      if (!skipIngest && process.stdin.isTTY) {
        console.log('  1. Restart Claude Code');
        console.log('  2. Ask Claude: "What did we work on recently?"');
      } else {
        console.log('  1. npx ecm batch-ingest ~/.claude/projects');
        console.log('  2. Restart Claude Code');
        console.log('  3. Ask Claude: "What did we work on recently?"');
      }
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
      const { batchIngestDirectory } = await import('../ingest/batch-ingest.js');
      const result = await batchIngestDirectory(args[0], {});
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
    name: 'encryption',
    description: 'Manage database encryption',
    usage: 'ecm encryption <setup|status|rotate-key|backup-key|restore-key|audit>',
    handler: async (args) => {
      const subcommand = args[0];
      const config = loadConfig();

      switch (subcommand) {
        case 'setup': {
          const { generatePassword } = await import('../storage/encryption.js');
          const { storeDbKey } = await import('../storage/db.js');
          const fs = await import('node:fs');
          const path = await import('node:path');
          const os = await import('node:os');

          // Check for existing unencrypted database
          const dbPath = path.join(os.homedir(), '.ecm', 'memory.db');
          if (fs.existsSync(dbPath)) {
            // Check if database is unencrypted by looking for SQLite header
            const header = Buffer.alloc(16);
            const fd = fs.openSync(dbPath, 'r');
            fs.readSync(fd, header, 0, 16, 0);
            fs.closeSync(fd);

            const sqliteHeader = 'SQLite format 3';
            if (header.toString('utf-8', 0, 15) === sqliteHeader) {
              console.error('Warning: Existing unencrypted database detected!');
              console.error('');
              console.error('The database at ~/.ecm/memory.db is not encrypted.');
              console.error('Enabling encryption will make it unreadable.');
              console.error('');
              console.error('Options:');
              console.error('  1. Export data first:');
              console.error('     npx ecm export --output backup.json --no-encrypt');
              console.error('     rm ~/.ecm/memory.db');
              console.error('     npx ecm encryption setup');
              console.error('     npx ecm init');
              console.error('     npx ecm import backup.json');
              console.error('');
              console.error('  2. Start fresh (lose existing data):');
              console.error('     rm ~/.ecm/memory.db');
              console.error('     npx ecm encryption setup');
              console.error('');
              process.exit(1);
            }
          }

          console.log('Setting up database encryption...');
          console.log('');

          // Generate a strong random key
          const key = generatePassword(32);

          // Store in keychain
          await storeDbKey(key);
          console.log('✓ Encryption key stored in system keychain');

          // Update or create config file
          const configPath = path.join(os.homedir(), '.ecm', 'config.json');
          let existingConfig: Record<string, unknown> = {};

          if (fs.existsSync(configPath)) {
            try {
              existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            } catch {
              // Start fresh
            }
          }

          existingConfig.encryption = {
            enabled: true,
            cipher: 'chacha20',
            keySource: 'keychain',
          };

          const configDir = path.dirname(configPath);
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }
          fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
          console.log('✓ Updated ~/.ecm/config.json');

          console.log('');
          console.log('Encryption enabled with ChaCha20-Poly1305.');
          console.log('');
          console.log('IMPORTANT: Back up your encryption key:');
          console.log('  npx ecm encryption backup-key ~/ecm-key-backup.enc');
          console.log('');
          console.log('If you lose the key, your data cannot be recovered.');
          break;
        }

        case 'status': {
          const enabled = config.encryption?.enabled ?? false;
          const cipher = config.encryption?.cipher ?? 'chacha20';
          const keySource = config.encryption?.keySource ?? 'keychain';
          const auditLog = config.encryption?.auditLog ?? false;

          console.log('Database Encryption Status:');
          console.log(`  Enabled: ${enabled ? 'yes' : 'no'}`);
          if (enabled) {
            console.log(`  Cipher: ${cipher}`);
            console.log(`  Key source: ${keySource}`);
            console.log(`  Audit logging: ${auditLog ? 'yes' : 'no'}`);
          }
          break;
        }

        case 'rotate-key': {
          if (!config.encryption?.enabled) {
            console.error('Error: Encryption is not enabled.');
            console.log('Run "ecm encryption setup" first.');
            process.exit(1);
          }

          const { getDbKeyAsync, storeDbKey } = await import('../storage/db.js');
          const { generatePassword } = await import('../storage/encryption.js');
          const { logAudit } = await import('../storage/audit-log.js');

          // Get current key
          const currentKey = await getDbKeyAsync();
          if (!currentKey) {
            console.error('Error: Could not retrieve current encryption key.');
            process.exit(1);
          }

          console.log('Rotating database encryption key...');
          console.log('');

          // Generate new key
          const newKey = generatePassword(32);

          // Re-key the database
          try {
            const db = getDb();
            db.pragma(`rekey = '${newKey}'`);
            await storeDbKey(newKey);
            logAudit('key-rotate', 'Encryption key rotated');
            console.log('✓ Encryption key rotated successfully');
            console.log('');
            console.log('Remember to update your key backup:');
            console.log('  npx ecm encryption backup-key ~/ecm-key-backup.enc');
          } catch (error) {
            console.error(`Error rotating key: ${(error as Error).message}`);
            process.exit(1);
          }
          break;
        }

        case 'backup-key': {
          const outputPath = args[1] ?? 'ecm-key-backup.enc';
          const { getDbKeyAsync } = await import('../storage/db.js');
          const { encryptString } = await import('../storage/encryption.js');
          const fs = await import('node:fs');

          const key = await getDbKeyAsync();
          if (!key) {
            console.error('Error: No encryption key found.');
            console.log('Run "ecm encryption setup" first.');
            process.exit(1);
          }

          const backupPassword = await promptPassword('Enter backup password: ');
          if (!backupPassword) {
            console.error('Error: Backup password required.');
            process.exit(2);
          }
          const confirm = await promptPassword('Confirm backup password: ');
          if (backupPassword !== confirm) {
            console.error('Error: Passwords do not match.');
            process.exit(2);
          }

          // Encrypt the key with the backup password
          const encryptedKey = encryptString(key, backupPassword);
          fs.writeFileSync(outputPath, encryptedKey);

          console.log(`✓ Key backed up to: ${outputPath}`);
          console.log('');
          console.log('Store this file securely. You will need the backup password to restore.');
          break;
        }

        case 'restore-key': {
          const inputPath = args[1];
          if (!inputPath) {
            console.error('Error: Backup file path required');
            console.log('Usage: ecm encryption restore-key <backup-file>');
            process.exit(2);
          }

          const fs = await import('node:fs');
          const { decryptString } = await import('../storage/encryption.js');
          const { storeDbKey } = await import('../storage/db.js');

          if (!fs.existsSync(inputPath)) {
            console.error(`Error: File not found: ${inputPath}`);
            process.exit(1);
          }

          const encryptedKey = fs.readFileSync(inputPath, 'utf-8');
          const backupPassword = await promptPassword('Enter backup password: ');

          try {
            const key = decryptString(encryptedKey, backupPassword);
            await storeDbKey(key);
            console.log('✓ Key restored successfully');
          } catch {
            console.error('Error: Failed to decrypt. Wrong password?');
            process.exit(1);
          }
          break;
        }

        case 'audit': {
          const { readAuditLog, formatAuditEntries } = await import('../storage/audit-log.js');
          const limit = args[1] ? parseInt(args[1], 10) : 10;

          const entries = readAuditLog(limit);
          if (entries.length === 0) {
            console.log('No audit entries found.');
            console.log('');
            console.log('To enable audit logging, add to config:');
            console.log('  { "encryption": { "auditLog": true } }');
          } else {
            console.log(`Last ${entries.length} audit entries:`);
            console.log('');
            console.log(formatAuditEntries(entries));
          }
          break;
        }

        default:
          console.error('Error: Unknown subcommand');
          console.log('Usage: ecm encryption <setup|status|rotate-key|backup-key|restore-key|audit>');
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
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'ecm-backup.ecm';
      const noEncrypt = args.includes('--no-encrypt');

      let password: string | undefined;
      if (!noEncrypt) {
        // Try environment variable first
        password = process.env.ECM_EXPORT_PASSWORD;

        // If no env var and TTY available, prompt interactively
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
          // Non-TTY without env var - require explicit --no-encrypt
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
      const inputPath = args[0];
      const merge = args.includes('--merge');

      // Check if file is encrypted
      const encrypted = await isEncryptedArchive(inputPath);

      let password: string | undefined;
      if (encrypted) {
        // Try environment variable first
        password = process.env.ECM_EXPORT_PASSWORD;

        // If no env var and TTY available, prompt interactively
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
  },
  {
    name: 'uninstall',
    description: 'Remove ECM and all its artifacts',
    usage: 'ecm uninstall [--force] [--keep-data] [--dry-run]',
    handler: async (args) => {
      const { handleUninstall } = await import('./uninstall.js');
      await handleUninstall(args);
    },
  },
  {
    name: 'dashboard',
    description: 'Launch the web dashboard',
    usage: 'ecm dashboard [--port <port>]',
    handler: async (args) => {
      const portIndex = args.indexOf('--port');
      const port = portIndex >= 0 ? parseInt(args[portIndex + 1], 10) || 3333 : 3333;
      const { startDashboard } = await import('../dashboard/server.js');
      await startDashboard(port);
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
