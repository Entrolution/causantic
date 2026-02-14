/**
 * CLI: Run edge decay validation experiments.
 *
 * Usage: tsx scripts/run-edge-decay-experiments.ts [options]
 *
 * Options:
 *   --projects     Path to Claude projects directory (default: ~/.claude/projects)
 *   --max-sessions Maximum number of sessions to process (default: 30)
 *   --output       Output directory for results (default: benchmark-results)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { discoverSessions } from '../../src/eval/corpus-builder.js';
import { getSessionInfo } from '../../src/parser/session-reader.js';
import {
  runEdgeDecayExperiments,
  type SessionSource,
} from '../../src/eval/experiments/edge-decay/run-experiments.js';
import { PRESET_MODELS } from '../../src/eval/experiments/edge-decay/presets.js';

function parseArgs(): {
  projectsDir: string;
  maxSessions: number;
  outputDir: string;
} {
  const args = process.argv.slice(2);
  let projectsDir = join(homedir(), '.claude', 'projects');
  let maxSessions = 30;
  let outputDir = 'benchmark-results';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--projects' && args[i + 1]) {
      projectsDir = args[++i];
    } else if (args[i] === '--max-sessions' && args[i + 1]) {
      maxSessions = parseInt(args[++i], 10);
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Edge Decay Validation Experiments

Usage: npm run edge-decay-experiments [options]

Options:
  --projects <path>      Path to Claude projects directory
                         (default: ~/.claude/projects)
  --max-sessions <N>     Maximum sessions to process (default: 30)
  --output <path>        Output directory for results (default: benchmark-results)
  --help, -h             Show this help message

Experiments:
  1. Reference Extraction: Identify turn-to-turn references in session data
  2. Retrieval Ranking: Test if decay weights predict actual references (MRR)
  3. Time-Offset Correlation: Test if decay correlates with reference rates

Examples:
  npm run edge-decay-experiments
  npm run edge-decay-experiments -- --max-sessions 50
`);
      process.exit(0);
    }
  }

  return { projectsDir, maxSessions, outputDir };
}

/**
 * Discover all session files across all project subdirectories.
 */
async function discoverAllSessions(projectsRootDir: string): Promise<string[]> {
  const allSessions: { path: string; size: number }[] = [];

  try {
    const projectDirs = await readdir(projectsRootDir);

    for (const dir of projectDirs) {
      const projectPath = join(projectsRootDir, dir);
      try {
        const dirStat = await stat(projectPath);
        if (!dirStat.isDirectory()) continue;

        const sessions = await discoverSessions(projectPath);
        for (const sessionPath of sessions) {
          const sessionStat = await stat(sessionPath);
          allSessions.push({ path: sessionPath, size: sessionStat.size });
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch {
    // Fall back to treating projectsRootDir as a single project
    const sessions = await discoverSessions(projectsRootDir);
    for (const sessionPath of sessions) {
      const sessionStat = await stat(sessionPath);
      allSessions.push({ path: sessionPath, size: sessionStat.size });
    }
  }

  // Sort by size descending (richest sessions first)
  allSessions.sort((a, b) => b.size - a.size);

  return allSessions.map((s) => s.path);
}

async function main(): Promise<void> {
  const { projectsDir, maxSessions, outputDir } = parseArgs();

  console.log('Edge Decay Validation Experiments\n');
  console.log(`Projects directory: ${projectsDir}`);
  console.log(`Max sessions: ${maxSessions}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Decay models: ${PRESET_MODELS.map(m => m.id).join(', ')}\n`);

  await mkdir(outputDir, { recursive: true });

  // Step 1: Discover sessions
  console.log('======================================================================');
  console.log('  EDGE DECAY VALIDATION EXPERIMENTS');
  console.log('======================================================================');

  console.log('\n--- Discovering sessions ---');
  const sessionPaths = await discoverAllSessions(projectsDir);
  const selectedPaths = sessionPaths.slice(0, maxSessions);
  console.log(`Found ${sessionPaths.length} sessions, using ${selectedPaths.length}`);

  // Step 2: Build session sources
  const sessionSources: SessionSource[] = [];
  for (const path of selectedPaths) {
    try {
      const info = await getSessionInfo(path);
      sessionSources.push({
        path,
        sessionId: info.sessionId,
        sessionSlug: info.slug,
      });
    } catch {
      // Skip unreadable sessions
    }
  }

  // Step 3: Run experiments
  const results = await runEdgeDecayExperiments(sessionSources, {
    decayModels: PRESET_MODELS,
    runHopDistanceCorrelation: true,
    verbose: true,
  });

  // Step 4: Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultPath = join(outputDir, `edge-decay-experiments-${timestamp}.json`);
  await writeFile(resultPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${resultPath}`);
}

main().catch((err) => {
  console.error('Experiment failed:', err);
  process.exit(1);
});
