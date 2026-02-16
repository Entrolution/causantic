/**
 * CLI: Run the topic continuity detection experiment.
 *
 * Usage: tsx scripts/run-topic-continuity.ts [--projects path] [--max-sessions N] [--output path]
 *
 * Options:
 *   --projects     Path to Claude projects directory (default: ~/.claude/projects)
 *   --max-sessions Maximum number of sessions to process (default: 20)
 *   --time-gap     Time gap threshold in minutes for new topic label (default: 30)
 *   --output       Output directory for results (default: benchmark-results)
 *   --export-only  Only export labeled dataset, don't run classifier evaluation
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  runTopicContinuityExperiment,
  exportTransitionsDataset,
} from '../src/eval/experiments/topic-continuity/index.js';

function parseArgs(): {
  projectsDir: string;
  maxSessions: number;
  timeGapMinutes: number;
  outputDir: string;
  exportOnly: boolean;
} {
  const args = process.argv.slice(2);
  let projectsDir = join(homedir(), '.claude', 'projects');
  let maxSessions = 20;
  let timeGapMinutes = 30;
  let outputDir = 'benchmark-results';
  let exportOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--projects' && args[i + 1]) {
      projectsDir = args[++i];
    } else if (args[i] === '--max-sessions' && args[i + 1]) {
      maxSessions = parseInt(args[++i], 10);
    } else if (args[i] === '--time-gap' && args[i + 1]) {
      timeGapMinutes = parseInt(args[++i], 10);
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--export-only') {
      exportOnly = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Topic Continuity Detection Experiment

Usage: npm run topic-continuity [options]

Options:
  --projects <path>      Path to Claude projects directory
                         (default: ~/.claude/projects)
  --max-sessions <N>     Maximum sessions to process (default: 20)
  --time-gap <minutes>   Time gap threshold for new topic label (default: 30)
  --output <path>        Output directory for results (default: benchmark-results)
  --export-only          Only export labeled dataset, skip evaluation
  --help, -h             Show this help message

Examples:
  npm run topic-continuity
  npm run topic-continuity -- --max-sessions 50
  npm run topic-continuity -- --export-only --output ./data
`);
      process.exit(0);
    }
  }

  return { projectsDir, maxSessions, timeGapMinutes, outputDir, exportOnly };
}

async function main(): Promise<void> {
  const { projectsDir, maxSessions, timeGapMinutes, outputDir, exportOnly } = parseArgs();

  console.log('Topic Continuity Detection Experiment\n');
  console.log(`Projects directory: ${projectsDir}`);
  console.log(`Max sessions: ${maxSessions}`);
  console.log(`Time gap threshold: ${timeGapMinutes} minutes`);
  console.log(`Output directory: ${outputDir}\n`);

  await mkdir(outputDir, { recursive: true });

  if (exportOnly) {
    // Just export the labeled dataset
    const exportPath = join(outputDir, 'topic-continuity-dataset.json');
    await exportTransitionsDataset({ projectsDir, maxSessions, timeGapMinutes }, exportPath);
    return;
  }

  // Run full experiment
  const report = await runTopicContinuityExperiment({
    projectsDir,
    maxSessions,
    timeGapMinutes,
  });

  // Write JSON report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(outputDir, `topic-continuity-${timestamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);

  // Print recommendations
  if (report.recommendations.length > 0) {
    console.log('\n--- Recommendations ---');
    for (const rec of report.recommendations) {
      console.log(`  - ${rec}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
