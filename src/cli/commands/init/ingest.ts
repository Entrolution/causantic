import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runTask } from '../../../maintenance/scheduler.js';
import { getChunkCount } from '../../../storage/chunk-store.js';
import { promptUser } from '../../utils.js';
import { createSpinner } from './shared.js';
import { offerApiKeySetup } from './api-key.js';

export async function offerBatchIngest(): Promise<void> {
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

  const { detectDevice } = await import('../../../models/device-detector.js');
  const { setLogLevel } = await import('../../../utils/logger.js');
  const detectedDevice = detectDevice();
  console.log('');
  const availableHint = detectedDevice.available?.length
    ? ` (${detectedDevice.available.join(', ')} available)`
    : '';
  console.log(`\u2713 Inference: ${detectedDevice.label}${availableHint}`);
  console.log(`Importing ${projectsToIngest.length} project(s)...`);
  console.log('');

  setLogLevel('warn');

  const { discoverSessions, batchIngest } = await import('../../../ingest/batch-ingest.js');
  const { Embedder } = await import('../../../models/embedder.js');
  const { getModel } = await import('../../../models/model-registry.js');
  const { loadConfig, toRuntimeConfig } = await import('../../../config/loader.js');

  const runtimeConfig = toRuntimeConfig(loadConfig());
  const sharedEmbedder = new Embedder();
  await sharedEmbedder.load(getModel(runtimeConfig.embeddingModel), {
    device: detectedDevice.device,
  });

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

    const { setLogLevel: setPostLogLevel } = await import('../../../utils/logger.js');
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
