/**
 * Phase 0.3: Non-Coding Session Validation
 *
 * Confirm models work for non-coding conversations (e.g., pde-book sessions).
 *
 * Usage: npm run noncoding-validation -- [options]
 */

import { join } from 'node:path';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { discoverSessions } from '../src/eval/corpus-builder.js';
import { getSessionInfo } from '../src/parser/session-reader.js';
import { runEdgeDecayExperiments } from '../src/eval/experiments/edge-decay/run-experiments.js';
import type { SessionSource } from '../src/eval/experiments/edge-decay/reference-extractor.js';
import { PRESET_MODELS } from '../src/eval/experiments/edge-decay/presets.js';

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

/**
 * Build SessionSource array from paths with session info.
 */
async function buildSessionSources(paths: string[]): Promise<SessionSource[]> {
  const sources: SessionSource[] = [];
  for (const path of paths) {
    try {
      const info = await getSessionInfo(path);
      sources.push({
        path,
        sessionId: info.sessionId,
        sessionSlug: info.slug,
      });
    } catch {
      // Skip unreadable sessions
    }
  }
  return sources;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sessionsDir = process.env.CLAUDE_SESSIONS_DIR ?? `${process.env.HOME}/.claude/projects`;
  let projectFilter = 'pde-book'; // Filter to non-coding sessions
  let maxSessions = 20;
  let outputPath = 'benchmark-results/noncoding-validation.json';
  let compareWithCoding = true;
  const codingProjectFilter = 'semansiation'; // A coding project for comparison

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sessions-dir' && args[i + 1]) {
      sessionsDir = args[i + 1];
      i++;
    } else if (args[i] === '--project' && args[i + 1]) {
      projectFilter = args[i + 1];
      i++;
    } else if (args[i] === '--max-sessions' && args[i + 1]) {
      maxSessions = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--no-compare') {
      compareWithCoding = false;
    } else if (args[i] === '--help') {
      console.log(`
Phase 0.3: Non-Coding Session Validation

Confirm models work for non-coding conversations.

Usage: npm run noncoding-validation -- [options]

Options:
  --sessions-dir <path>    Sessions directory (default: ~/.claude/projects)
  --project <name>         Project folder to filter for (default: pde-book)
  --max-sessions <n>       Maximum sessions to analyze (default: 20)
  --output <path>          Output JSON file (default: benchmark-results/noncoding-validation.json)
  --no-compare             Don't compare with coding sessions
  --help                   Show this help message

Example:
  npm run noncoding-validation -- --project pde-book --max-sessions 10
      `);
      process.exit(0);
    }
  }

  console.log('\n=== Phase 0.3: Non-Coding Session Validation ===\n');

  // Discover all sessions
  console.log(`Discovering sessions in ${sessionsDir}...`);
  const allSessionPaths = await discoverAllSessions(sessionsDir);
  console.log(`Found ${allSessionPaths.length} total sessions`);

  // Filter to non-coding project
  const nonCodingPaths = allSessionPaths
    .filter((path) => path.includes(projectFilter))
    .slice(0, maxSessions);

  console.log(`Found ${nonCodingPaths.length} sessions for "${projectFilter}"`);

  if (nonCodingPaths.length === 0) {
    console.log(`\nNo sessions found for project "${projectFilter}".`);
    console.log('Try a different --project name or check your sessions directory.');
    process.exit(1);
  }

  const nonCodingSessions = await buildSessionSources(nonCodingPaths);

  // Run experiments on non-coding sessions
  console.log(`\n--- Running experiments on ${projectFilter} (non-coding) ---`);

  const nonCodingResults = await runEdgeDecayExperiments(nonCodingSessions, {
    decayModels: PRESET_MODELS,
    runTimeOffsetCorrelation: true,
    runStratifiedAnalysis: true,
    verbose: true,
  });

  // Compare with coding sessions if requested
  let codingResults;
  if (compareWithCoding) {
    const codingPaths = allSessionPaths
      .filter((path) => path.includes(codingProjectFilter))
      .slice(0, maxSessions);

    if (codingPaths.length > 0) {
      console.log(`\n--- Running experiments on ${codingProjectFilter} (coding) ---`);
      console.log(`Found ${codingPaths.length} sessions for comparison`);

      const codingSessions = await buildSessionSources(codingPaths);

      codingResults = await runEdgeDecayExperiments(codingSessions, {
        decayModels: PRESET_MODELS,
        runTimeOffsetCorrelation: true,
        runStratifiedAnalysis: false, // Skip detailed stratification
        verbose: false,
      });
    }
  }

  // Write results
  const output = {
    nonCoding: nonCodingResults,
    coding: codingResults,
    comparison: codingResults ? generateComparison(nonCodingResults, codingResults) : null,
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outputPath}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`\nNon-coding (${projectFilter}):`);
  console.log(`  Sessions: ${nonCodingResults.sessionCount}`);
  console.log(`  References: ${nonCodingResults.referenceCount}`);

  const nonCodingBest = [...nonCodingResults.retrievalRanking].sort((a, b) => b.mrr - a.mrr)[0];
  console.log(`  Best model: ${nonCodingBest.modelName} (MRR=${nonCodingBest.mrr.toFixed(3)})`);

  if (codingResults) {
    console.log(`\nCoding (${codingProjectFilter}):`);
    console.log(`  Sessions: ${codingResults.sessionCount}`);
    console.log(`  References: ${codingResults.referenceCount}`);

    const codingBest = [...codingResults.retrievalRanking].sort((a, b) => b.mrr - a.mrr)[0];
    console.log(`  Best model: ${codingBest.modelName} (MRR=${codingBest.mrr.toFixed(3)})`);

    // Compare models
    console.log('\n--- Model Comparison (non-coding vs coding) ---');
    console.log('Model                     | Non-Coding MRR | Coding MRR | Diff');
    console.log('-'.repeat(70));

    for (const ncResult of nonCodingResults.retrievalRanking) {
      const codingResult = codingResults.retrievalRanking.find(
        (r) => r.modelId === ncResult.modelId,
      );
      if (codingResult) {
        const diff = ncResult.mrr - codingResult.mrr;
        const sign = diff >= 0 ? '+' : '';
        console.log(
          `${ncResult.modelName.padEnd(25)} | ${ncResult.mrr.toFixed(3).padEnd(14)} | ${codingResult.mrr.toFixed(3).padEnd(10)} | ${sign}${(diff * 100).toFixed(1)}%`,
        );
      }
    }

    // Conclusion
    const avgNonCoding =
      nonCodingResults.retrievalRanking.reduce((sum, r) => sum + r.mrr, 0) /
      nonCodingResults.retrievalRanking.length;
    const avgCoding =
      codingResults.retrievalRanking.reduce((sum, r) => sum + r.mrr, 0) /
      codingResults.retrievalRanking.length;
    const avgDiff = avgNonCoding - avgCoding;

    console.log('-'.repeat(70));
    if (Math.abs(avgDiff) < 0.02) {
      console.log('\n✓ Models perform similarly on non-coding and coding sessions');
    } else if (avgDiff > 0) {
      console.log(
        `\n✓ Models perform ${(avgDiff * 100).toFixed(1)}% better on non-coding sessions`,
      );
    } else {
      console.log(
        `\n⚠ Models perform ${(-avgDiff * 100).toFixed(1)}% worse on non-coding sessions`,
      );
      console.log('  Consider parameter adjustments for non-coding use cases');
    }
  }
}

function generateComparison(
  nonCoding: { retrievalRanking: Array<{ modelId: string; mrr: number }> },
  coding: { retrievalRanking: Array<{ modelId: string; mrr: number }> },
): Record<string, { nonCodingMrr: number; codingMrr: number; diff: number }> {
  const comparison: Record<string, { nonCodingMrr: number; codingMrr: number; diff: number }> = {};

  for (const ncResult of nonCoding.retrievalRanking) {
    const codingResult = coding.retrievalRanking.find((r) => r.modelId === ncResult.modelId);
    if (codingResult) {
      comparison[ncResult.modelId] = {
        nonCodingMrr: ncResult.mrr,
        codingMrr: codingResult.mrr,
        diff: ncResult.mrr - codingResult.mrr,
      };
    }
  }

  return comparison;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
