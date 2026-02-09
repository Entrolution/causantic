/**
 * CLI script for batch ingesting sessions.
 * Usage: npm run batch-ingest -- [options]
 */

import { batchIngestDirectory, discoverSessions, batchIngest } from '../src/ingest/batch-ingest.js';
import { getDbStats, closeDb } from '../src/storage/db.js';

async function main(): Promise<void> {
  // Parse arguments
  const args = process.argv.slice(2);
  let concurrency = 1;
  let resumeFrom: string | undefined;
  let sessionsDir = process.env.CLAUDE_SESSIONS_DIR ?? `${process.env.HOME}/.claude/projects`;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--resume' && args[i + 1]) {
      resumeFrom = args[i + 1];
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      sessionsDir = args[i + 1];
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run batch-ingest -- [options]

Options:
  --dir <path>        Sessions directory (default: ~/.claude/projects)
  --concurrency <n>   Number of concurrent workers (default: 1)
  --resume <id>       Resume from session ID
  --help              Show this help message

Example:
  npm run batch-ingest -- --dir ~/.claude/projects --concurrency 4
      `);
      process.exit(0);
    }
  }

  console.log(`Discovering sessions in ${sessionsDir}...`);
  const sessionPaths = await discoverSessions(sessionsDir);
  console.log(`Found ${sessionPaths.length} sessions`);

  if (sessionPaths.length === 0) {
    console.log('No sessions to ingest.');
    return;
  }

  console.log(`\nIngesting with concurrency=${concurrency}...`);
  if (resumeFrom) {
    console.log(`Resuming from: ${resumeFrom}`);
  }

  const result = await batchIngest(sessionPaths, {
    concurrency,
    resumeFrom,
    progressCallback: (done, total, current) => {
      const pct = ((done / total) * 100).toFixed(1);
      process.stdout.write(`\r[${pct}%] ${done}/${total} - ${current.split('/').pop()}`);
    },
  });

  console.log('\n\n=== Batch Ingestion Complete ===');
  console.log(`Sessions:        ${result.successCount}/${result.totalSessions} ingested`);
  console.log(`Skipped:         ${result.skippedCount} (already existed)`);
  console.log(`Errors:          ${result.errorCount}`);
  console.log(`Total chunks:    ${result.totalChunks}`);
  console.log(`Total edges:     ${result.totalEdges}`);
  console.log(`Cross-session:   ${result.crossSessionEdges} edges`);
  console.log(`Sub-agents:      ${result.subAgentCount} processed`);
  console.log(`Sub-agent edges: ${result.subAgentEdges} (brief+debrief)`);
  console.log(`Duration:        ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${err.path}: ${err.error}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }

  // Show database stats
  const stats = getDbStats();
  console.log('\n=== Database Stats ===');
  console.log(`Chunks:          ${stats.chunks}`);
  console.log(`Edges:           ${stats.edges}`);
  console.log(`Clusters:        ${stats.clusters}`);
  console.log(`Assignments:     ${stats.assignments}`);

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
