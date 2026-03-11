/**
 * Run index entry backfill on all unindexed chunks.
 *
 * Usage:
 *   npx tsx scripts/backfill-index.ts [--limit N] [--replace-heuristic] [--replace-llm] [--replace-all]
 *
 * --replace-heuristic: Delete existing heuristic entries first so they
 *                      get regenerated via LLM/jeopardy.
 * --replace-llm:       Delete existing LLM (summary-style) entries first
 *                      so they get regenerated as jeopardy entries.
 * --replace-all:       Delete both LLM and heuristic entries for clean
 *                      regeneration with jeopardy-style entries.
 */

import { getDb } from '../src/storage/db.js';
import { indexRefresher } from '../src/index-entries/index-refresher.js';
import { indexVectorStore } from '../src/storage/vector-store.js';

async function deleteEntriesByMethod(method: string): Promise<number> {
  const db = getDb();

  const rows = db
    .prepare('SELECT id FROM index_entries WHERE generation_method = ?')
    .all(method) as Array<{ id: string }>;

  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);

  db.transaction(() => {
    for (const id of ids) {
      db.prepare('DELETE FROM index_entry_chunks WHERE index_entry_id = ?').run(id);
      db.prepare('DELETE FROM index_entries WHERE id = ?').run(id);
    }
  })();

  // Batch vector store deletions to avoid SQLite variable limit
  const BATCH_SIZE = 500;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    await indexVectorStore.deleteBatch(ids.slice(i, i + BATCH_SIZE));
  }
  return ids.length;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20000;
  const replaceHeuristic = args.includes('--replace-heuristic') || args.includes('--replace-all');
  const replaceLlm = args.includes('--replace-llm') || args.includes('--replace-all');
  const replaceJeopardy = args.includes('--replace-jeopardy') || args.includes('--replace-all');

  if (replaceJeopardy) {
    console.log('Deleting jeopardy entries for regeneration...');
    const deleted = await deleteEntriesByMethod('jeopardy');
    console.log(`  Deleted ${deleted} jeopardy entries\n`);
  }

  if (replaceLlm) {
    console.log('Deleting LLM (summary) entries for regeneration...');
    const deleted = await deleteEntriesByMethod('llm');
    console.log(`  Deleted ${deleted} LLM entries\n`);
  }

  if (replaceHeuristic) {
    console.log('Deleting heuristic entries for regeneration...');
    const deleted = await deleteEntriesByMethod('heuristic');
    console.log(`  Deleted ${deleted} heuristic entries\n`);
  }

  console.log(`Starting index backfill (limit=${limit})...\n`);

  const status = indexRefresher.getBackfillStatus();
  console.log(`Current status: ${status.indexed}/${status.total} indexed (${status.remaining} remaining)\n`);

  const result = await indexRefresher.backfill({
    limit,
    onProgress: (current, total) => {
      if (current % 5 === 0 || current === total) {
        console.log(`  Session ${current}/${total}`);
      }
    },
  });

  console.log('\nBackfill complete:');
  console.log(`  Entries created: ${result.entriesCreated}`);
  console.log(`  Jeopardy entries: ${result.jeopardyEntries}`);
  console.log(`  LLM entries: ${result.llmEntries}`);
  console.log(`  Heuristic entries: ${result.heuristicEntries}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

  const finalStatus = indexRefresher.getBackfillStatus();
  console.log(`\nFinal status: ${finalStatus.indexed}/${finalStatus.total} indexed (${finalStatus.remaining} remaining)`);

  // Show generation method breakdown
  const db = getDb();
  const methods = db
    .prepare('SELECT generation_method, COUNT(*) as cnt FROM index_entries GROUP BY generation_method')
    .all() as Array<{ generation_method: string; cnt: number }>;
  console.log('\nGeneration methods:');
  for (const m of methods) {
    console.log(`  ${m.generation_method}: ${m.cnt}`);
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
