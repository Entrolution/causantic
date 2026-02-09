/**
 * CLI script for ingesting a single session.
 * Usage: npm run ingest -- <session-path>
 */

import { ingestSession } from '../src/ingest/ingest-session.js';
import { closeDb } from '../src/storage/db.js';

async function main(): Promise<void> {
  const sessionPath = process.argv[2];

  if (!sessionPath || sessionPath === '--help') {
    console.log(`
Usage: npm run ingest -- <session-path>

Arguments:
  session-path    Path to the session JSONL file

Example:
  npm run ingest -- ~/.claude/projects/my-project/abc123.jsonl
    `);
    process.exit(sessionPath ? 0 : 1);
  }

  console.log(`Ingesting session: ${sessionPath}`);

  const result = await ingestSession(sessionPath);

  if (result.skipped) {
    console.log(`Session ${result.sessionId} already ingested, skipped.`);
  } else {
    console.log(`\nIngested session ${result.sessionId}:`);
    console.log(`  Slug:           ${result.sessionSlug}`);
    console.log(`  Chunks:         ${result.chunkCount}`);
    console.log(`  Edges:          ${result.edgeCount}`);
    console.log(`  Cross-session:  ${result.crossSessionEdges} edges`);
    console.log(`  Duration:       ${result.durationMs}ms`);
  }

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
