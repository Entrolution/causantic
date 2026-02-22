/**
 * CLI command: re-embed all chunks with the configured embedding model.
 *
 * Usage: npx causantic reindex [--batch-size N] [--dry-run]
 */

import type { Command } from '../types.js';
import { getDb } from '../../storage/db.js';
import { Embedder } from '../../models/embedder.js';
import { getModel } from '../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../config/loader.js';
import { serializeEmbedding } from '../../utils/embedding-utils.js';

/**
 * Get or create a progress tracking table and return the last completed batch.
 */
function getLastCompletedBatch(db: ReturnType<typeof getDb>, modelId: string): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reindex_progress (
      model_id TEXT PRIMARY KEY,
      last_batch INTEGER NOT NULL DEFAULT 0,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const row = db
    .prepare('SELECT last_batch FROM reindex_progress WHERE model_id = ?')
    .get(modelId) as { last_batch: number } | undefined;

  return row?.last_batch ?? 0;
}

function updateProgress(db: ReturnType<typeof getDb>, modelId: string, batch: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO reindex_progress (model_id, last_batch, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
  ).run(modelId, batch);
}

function clearProgress(db: ReturnType<typeof getDb>, modelId: string): void {
  db.prepare('DELETE FROM reindex_progress WHERE model_id = ?').run(modelId);
}

export const reindexCommand: Command = {
  name: 'reindex',
  description: 'Re-embed all chunks with the configured embedding model',
  usage: 'causantic reindex [--batch-size N] [--dry-run]',
  handler: async (args: string[]) => {
    if (args.includes('--help') || args.includes('-h')) {
      console.log('Usage: causantic reindex [--batch-size N] [--dry-run]');
      console.log('');
      console.log('Re-embeds all chunks using the configured embedding model.');
      console.log('Processes in batches with progress tracking for safe resumption.');
      console.log('');
      console.log('Options:');
      console.log('  --batch-size N  Chunks per batch (default: 100)');
      console.log('  --dry-run       Show what would be done without making changes');
      return;
    }

    const dryRun = args.includes('--dry-run');
    let batchSize = 100;

    const batchIdx = args.indexOf('--batch-size');
    if (batchIdx !== -1 && args[batchIdx + 1]) {
      batchSize = parseInt(args[batchIdx + 1], 10);
      if (isNaN(batchSize) || batchSize < 1) {
        console.error('Error: --batch-size must be a positive integer');
        process.exit(1);
      }
    }

    const config = toRuntimeConfig(loadConfig());
    const targetModel = config.embeddingModel;
    const modelConfig = getModel(targetModel);

    console.log(`Reindex target: ${targetModel} (${modelConfig.dims}D)`);

    const db = getDb();

    // Count chunks that need re-embedding
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const totalChunks = totalRow.count;

    if (totalChunks === 0) {
      console.log('No chunks to reindex.');
      return;
    }

    // Count existing vectors for the target model
    const existingRow = db
      .prepare('SELECT COUNT(*) as count FROM vectors WHERE model_id = ?')
      .get(targetModel) as { count: number };

    // Count vectors with different model
    const otherModelRow = db
      .prepare('SELECT COUNT(*) as count FROM vectors WHERE model_id != ?')
      .get(targetModel) as { count: number };

    console.log(`Chunks: ${totalChunks}`);
    console.log(`Existing vectors (${targetModel}): ${existingRow.count}`);
    if (otherModelRow.count > 0) {
      console.log(`Vectors (other models): ${otherModelRow.count} (will be replaced)`);
    }

    const totalBatches = Math.ceil(totalChunks / batchSize);
    const lastBatch = getLastCompletedBatch(db, targetModel);

    if (lastBatch > 0) {
      console.log(`Resuming from batch ${lastBatch + 1}/${totalBatches}`);
    }

    if (dryRun) {
      console.log(`\nDry run: would process ${totalChunks} chunks in ${totalBatches} batches`);
      return;
    }

    // Load the embedder
    const embedder = new Embedder();
    await embedder.load(modelConfig);

    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO vectors (id, embedding, orphaned_at, last_accessed, model_id) VALUES (?, ?, NULL, CURRENT_TIMESTAMP, ?)',
    );
    const deleteOldStmt = db.prepare(
      'DELETE FROM vectors WHERE id = ? AND model_id != ?',
    );

    // Process in batches
    const allChunks = db
      .prepare('SELECT id, content FROM chunks ORDER BY created_at ASC')
      .all() as Array<{ id: string; content: string }>;

    let processed = lastBatch * batchSize;
    const startTime = Date.now();

    for (let batch = lastBatch; batch < totalBatches; batch++) {
      const start = batch * batchSize;
      const end = Math.min(start + batchSize, allChunks.length);
      const batchChunks = allChunks.slice(start, end);

      // Embed all chunks in this batch
      const embeddings: Array<{ id: string; embedding: number[] }> = [];
      for (const chunk of batchChunks) {
        const result = await embedder.embed(chunk.content, false);
        embeddings.push({ id: chunk.id, embedding: result.embedding });
      }

      // Write to DB in a transaction
      db.transaction(() => {
        for (const { id, embedding } of embeddings) {
          const blob = serializeEmbedding(embedding);
          insertStmt.run(id, blob, targetModel);
          // Remove old-model vectors for this chunk
          deleteOldStmt.run(id, targetModel);
        }
      })();

      processed += batchChunks.length;
      updateProgress(db, targetModel, batch + 1);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.round((processed / allChunks.length) * 100);
      process.stdout.write(`\r  [${pct}%] ${processed}/${allChunks.length} chunks (${elapsed}s)`);
    }

    console.log(''); // newline after progress

    // Clean up progress tracker
    clearProgress(db, targetModel);

    // Clean up any remaining vectors from other models that don't correspond to chunks
    const cleanedUp = db
      .prepare('DELETE FROM vectors WHERE model_id != ?')
      .run(targetModel);

    if (cleanedUp.changes > 0) {
      console.log(`Cleaned up ${cleanedUp.changes} orphaned vectors from other models`);
    }

    await embedder.dispose();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Reindex complete: ${processed} chunks re-embedded with ${targetModel} in ${duration}s`);
  },
};
