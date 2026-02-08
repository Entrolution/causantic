/**
 * Phase 0.2: Run hold period parameter sweep.
 *
 * Verifies optimal hold period for retrieval decay.
 *
 * Usage: npm run hold-period-sweep -- [options]
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { discoverSessions } from '../src/eval/corpus-builder.js';
import { getSessionInfo } from '../src/parser/session-reader.js';
import { runEdgeDecayExperiments } from '../src/eval/experiments/edge-decay/run-experiments.js';
import type { SessionSource } from '../src/eval/experiments/edge-decay/reference-extractor.js';
import { HOLD_PERIOD_VARIANTS } from '../src/eval/experiments/edge-decay/presets.js';

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
  const args = process.argv.slice(2);
  let sessionsDir = process.env.CLAUDE_SESSIONS_DIR ?? `${process.env.HOME}/.claude/projects`;
  let maxSessions = 75;
  let outputPath = 'benchmark-results/hold-period-sweep.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sessions-dir' && args[i + 1]) {
      sessionsDir = args[i + 1];
      i++;
    } else if (args[i] === '--max-sessions' && args[i + 1]) {
      maxSessions = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Phase 0.2: Hold Period Parameter Sweep

Verify optimal hold period for retrieval decay.

Usage: npm run hold-period-sweep -- [options]

Options:
  --sessions-dir <path>    Sessions directory (default: ~/.claude/projects)
  --max-sessions <n>       Maximum sessions to analyze (default: 75)
  --output <path>          Output JSON file (default: benchmark-results/hold-period-sweep.json)
  --help                   Show this help message

Example:
  npm run hold-period-sweep -- --max-sessions 50
      `);
      process.exit(0);
    }
  }

  console.log('\n=== Phase 0.2: Hold Period Parameter Sweep ===\n');
  console.log(`Sessions directory: ${sessionsDir}`);
  console.log(`Max sessions: ${maxSessions}`);

  // Discover sessions across all project directories
  console.log('\nDiscovering sessions...');
  const allSessionPaths = await discoverAllSessions(sessionsDir);
  console.log(`Found ${allSessionPaths.length} sessions`);

  // Sample and build session sources
  const selectedPaths = allSessionPaths
    .sort(() => Math.random() - 0.5)
    .slice(0, maxSessions);

  const sessions: SessionSource[] = [];
  for (const path of selectedPaths) {
    try {
      const info = await getSessionInfo(path);
      sessions.push({
        path,
        sessionId: info.sessionId,
        sessionSlug: info.slug,
      });
    } catch {
      // Skip unreadable sessions
    }
  }

  console.log(`Using ${sessions.length} sessions for analysis`);

  // Run experiments with hold period variants
  console.log('\nRunning edge decay experiments with hold period variants...');
  console.log('Models: ' + HOLD_PERIOD_VARIANTS.map((m) => m.name).join(', '));

  const results = await runEdgeDecayExperiments(sessions, {
    decayModels: HOLD_PERIOD_VARIANTS,
    runTimeOffsetCorrelation: true,
    runStratifiedAnalysis: true,
    runDirectionalAnalysis: true,
    verbose: true,
  });

  // Write results
  await writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${outputPath}`);

  // Summary: Find best hold period
  console.log('\n=== Hold Period Comparison ===');

  const sorted = [...results.retrievalRanking].sort((a, b) => b.mrr - a.mrr);

  console.log('\nBy MRR:');
  for (const r of sorted) {
    const holdMatch = r.modelName.match(/\((\d+)min\)/);
    const hold = holdMatch ? holdMatch[1] : '?';
    console.log(`  ${hold}min hold: MRR=${r.mrr.toFixed(3)}, Rank@1=${r.rankDistribution.rank1} (${((r.rankDistribution.rank1 / r.queryCount) * 100).toFixed(0)}%)`);
  }

  const best = sorted[0];
  const holdMatch = best.modelName.match(/\((\d+)min\)/);
  const bestHold = holdMatch ? holdMatch[1] : '?';

  console.log(`\n*** Recommended hold period: ${bestHold} minutes ***`);
  console.log(`    (MRR=${best.mrr.toFixed(3)}, Rank@1=${((best.rankDistribution.rank1 / best.queryCount) * 100).toFixed(0)}%)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
