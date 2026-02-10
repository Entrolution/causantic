import type { Command } from '../types.js';
import { runTask } from '../../maintenance/scheduler.js';
import { getDb } from '../../storage/db.js';
import { getChunkCount } from '../../storage/chunk-store.js';
import { createSecretStore } from '../../utils/secret-store.js';
import { promptPassword } from '../utils.js';

export const initCommand: Command = {
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
      console.log(`\u2713 Node.js ${nodeVersion}`);
    } else {
      console.log(`\u2717 Node.js ${nodeVersion} (requires 20+)`);
      process.exit(1);
    }

    // Step 2: Create directory structure
    const ecmDir = path.join(os.homedir(), '.ecm');
    const vectorsDir = path.join(ecmDir, 'vectors');

    if (!fs.existsSync(ecmDir)) {
      fs.mkdirSync(ecmDir, { recursive: true });
      console.log(`\u2713 Created ${ecmDir}`);
    } else {
      console.log(`\u2713 Directory exists: ${ecmDir}`);
    }

    if (!fs.existsSync(vectorsDir)) {
      fs.mkdirSync(vectorsDir, { recursive: true });
      console.log(`\u2713 Created ${vectorsDir}`);
    } else {
      console.log(`\u2713 Directory exists: ${vectorsDir}`);
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
        const { generatePassword } = await import('../../storage/encryption.js');
        const { storeDbKey } = await import('../../storage/db.js');

        console.log('');
        console.log('Generating encryption key...');

        const key = generatePassword(32);
        await storeDbKey(key);

        const configPath = path.join(ecmDir, 'config.json');
        const encryptionConfig = {
          encryption: {
            enabled: true,
            cipher: 'chacha20',
            keySource: 'keychain',
          },
        };
        fs.writeFileSync(configPath, JSON.stringify(encryptionConfig, null, 2));

        console.log('\u2713 Key stored in system keychain');
        console.log('\u2713 Encryption enabled with ChaCha20-Poly1305');
        encryptionEnabled = true;
      }
    }

    // Step 4: Initialize database
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      console.log('\u2713 Database initialized' + (encryptionEnabled ? ' (encrypted)' : ''));
    } catch (error) {
      console.log(`\u2717 Database error: ${(error as Error).message}`);
      process.exit(1);
    }

    // Step 5: Detect Claude Code config path
    const claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');

    console.log('');
    console.log(`Claude Code config: ${claudeConfigPath}`);

    // Step 6: Offer to configure MCP
    if (!skipMcp) {
      const configExists = fs.existsSync(claudeConfigPath);

      if (configExists) {
        console.log('\u2713 Claude Code config found');

        try {
          const configContent = fs.readFileSync(claudeConfigPath, 'utf-8');
          const config = JSON.parse(configContent);

          const ECM_SERVER_KEY = 'entropic-causal-memory';

          // Migrate old 'memory' key -> 'entropic-causal-memory'
          if (config.mcpServers?.memory && !config.mcpServers[ECM_SERVER_KEY]) {
            config.mcpServers[ECM_SERVER_KEY] = config.mcpServers.memory;
            delete config.mcpServers.memory;
            fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
            console.log('\u2713 Migrated ECM config: memory \u2192 entropic-causal-memory');
          }

          if (config.mcpServers?.[ECM_SERVER_KEY]) {
            if (config.mcpServers[ECM_SERVER_KEY].command === 'npx') {
              const nodeBin = process.execPath;
              const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/../index.js';

              config.mcpServers[ECM_SERVER_KEY] = {
                command: nodeBin,
                args: [cliEntry, 'serve'],
              };
              fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
              console.log('\u2713 Updated ECM config to use absolute paths');
            } else {
              console.log('\u2713 ECM already configured in Claude Code');
            }
          } else {
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
              const nodeBin = process.execPath;
              const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/../index.js';

              config.mcpServers = config.mcpServers || {};
              config.mcpServers[ECM_SERVER_KEY] = {
                command: nodeBin,
                args: [cliEntry, 'serve'],
              };
              fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
              console.log('\u2713 Added ECM to Claude Code config');
              console.log(`  Node: ${nodeBin}`);
              console.log('  Restart Claude Code to activate');
            }
          }
        } catch {
          console.log('\u26a0 Could not parse Claude Code config');
        }
      } else {
        console.log('\u26a0 Claude Code config not found');
        console.log('  Create it manually or install Claude Code first');
      }
    }

    // Step 6b: Patch project-level .mcp.json files
    if (!skipMcp && process.stdin.isTTY) {
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (fs.existsSync(claudeProjectsDir)) {
        const nodeBin = process.execPath;
        const cliEntry = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/../index.js';
        const memoryServerConfig = {
          command: nodeBin,
          args: [cliEntry, 'serve'],
        };

        const ECM_KEY = 'entropic-causal-memory';

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

              if (mcpContent.mcpServers.memory && !mcpContent.mcpServers[ECM_KEY]) {
                const readableName = projectPath.replace(new RegExp(`^/Users/${os.userInfo().username}/`), '~/');
                projectsToFix.push({ name: readableName, mcpPath, needsMigrate: true });
              } else if (!mcpContent.mcpServers[ECM_KEY]) {
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
                console.log(`  \u26a0 Could not patch ${p.name}`);
              }
            }
            if (patched > 0) {
              console.log(`\u2713 Updated ECM in ${patched} project .mcp.json file(s)`);
            }
          }
        }
      }
    }

    // Step 6c: Install ECM skills and update CLAUDE.md reference
    if (!skipMcp) {
      const { ECM_SKILLS, getMinimalClaudeMdBlock } = await import('../skill-templates.js');

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
          console.log(`\u26a0 Could not install skill: ${skill.dirName}`);
        }
      }

      if (skillsInstalled > 0) {
        console.log(`\u2713 Installed ${skillsInstalled} ECM skills to ~/.claude/skills/`);
      }

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
          const startIdx = claudeMd.indexOf(ECM_START);
          const endIdx = claudeMd.indexOf(ECM_END);
          if (endIdx > startIdx) {
            claudeMd = claudeMd.slice(0, startIdx) + memoryInstructions + claudeMd.slice(endIdx + ECM_END.length);
            fs.writeFileSync(claudeMdPath, claudeMd);
            console.log('\u2713 Updated CLAUDE.md with skill references');
          }
        } else {
          const separator = claudeMd.length > 0 && !claudeMd.endsWith('\n\n') ? '\n' : '';
          fs.writeFileSync(claudeMdPath, claudeMd + separator + memoryInstructions + '\n');
          console.log('\u2713 Added ECM reference to CLAUDE.md');
        }
      } catch {
        console.log('\u26a0 Could not update CLAUDE.md');
      }
    }

    // Step 7: Health check
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

    // Step 8: Offer to ingest existing Claude sessions
    const skipIngest = args.includes('--skip-ingest');
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    if (!skipIngest && process.stdin.isTTY && fs.existsSync(claudeProjectsDir)) {
      console.log('');
      console.log('Existing Claude Code sessions found.');

      const projectDirs: Array<{ name: string; path: string; sessionCount: number }> = [];
      try {
        const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const projectPath = path.join(claudeProjectsDir, entry.name);
            const files = fs.readdirSync(projectPath);
            const sessionCount = files.filter((f: string) =>
              f.endsWith('.jsonl') &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(f)
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

      if (projectDirs.length > 0) {
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
        const spinFrames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
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
            const projectName = path.basename(projectPath)
              .replace(/^-/, '')
              .replace(/-/g, '/')
              .replace(/^Users\/[^/]+\//, '~/');

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

          // Run post-ingestion maintenance tasks
          const existingChunks = getChunkCount();
          if (existingChunks > 0) {
            console.log('');
            console.log('Running post-ingestion processing...');

            const { setLogLevel: setPostLogLevel } = await import('../../utils/logger.js');
            setPostLogLevel('warn');

            startSpinner('Pruning graph...');
            try {
              const pruneResult = await runTask('prune-graph');
              stopSpinner(pruneResult.success
                ? '  \u2713 Graph pruned'
                : `  \u26a0 Pruning: ${pruneResult.message}`);
            } catch (err) {
              stopSpinner(`  \u2717 Pruning error: ${(err as Error).message}`);
            }

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
                const store = createSecretStore();
                await store.set('anthropic-api-key', apiKey);
                console.log('\u2713 API key stored in system keychain');

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
                console.log('\u26a0 Invalid API key format (should start with sk-ant-)');
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
};
