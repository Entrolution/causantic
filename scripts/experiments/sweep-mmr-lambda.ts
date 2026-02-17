#!/usr/bin/env npx tsx
/**
 * Sweep MMR lambda values to find optimal default.
 *
 * Runs search queries at various lambda values and measures:
 * - Source mix (vector / keyword / cluster %)
 * - Adjacent recall (does relevance quality hold?)
 *
 * Usage: npx tsx scripts/experiments/sweep-mmr-lambda.ts
 */

import { getDb } from '../../src/storage/db.js';
import { vectorStore } from '../../src/storage/vector-store.js';
import { searchContext } from '../../src/retrieval/search-assembler.js';
import { getForwardEdges } from '../../src/storage/edge-store.js';
import { loadConfig } from '../../src/config/loader.js';
import { resolvePath } from '../../src/config/memory-config.js';

// Seed a simple PRNG for reproducible sampling
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  // Init database
  const config = loadConfig();
  const dbPath = resolvePath(config.storage?.dbPath ?? '~/.causantic/memory.db');
  getDb(dbPath);

  // Load vectors
  await vectorStore.load();
  const vectorCount = await vectorStore.count();

  // Sample query chunks: pick chunks that have forward edges (so adjacent recall is measurable)
  const db = getDb();
  const allChunks = db
    .prepare(
      `SELECT c.id, c.session_slug, c.content FROM chunks c
       WHERE c.content != '' AND length(c.content) > 100
       ORDER BY c.start_time DESC LIMIT 2000`,
    )
    .all() as Array<{ id: string; session_slug: string; content: string }>;

  // Filter to chunks with forward edges
  const chunksWithEdges = allChunks.filter((c) => {
    const edges = getForwardEdges(c.id);
    return edges.length > 0;
  });

  // Sample 30 queries reproducibly
  const rng = mulberry32(42);
  const sampleSize = Math.min(30, chunksWithEdges.length);
  const shuffled = [...chunksWithEdges].sort(() => rng() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  console.log(`Collection: ${allChunks.length} chunks, ${vectorCount} vectors`);
  console.log(`Sample: ${sampleSize} queries (with forward edges)\n`);

  // Lambda values to sweep
  const lambdas = [0.0, 0.3, 0.5, 0.6, 0.7, 0.8, 1.0];

  console.log(
    '| Lambda | Vector% | Keyword% | Cluster% | Adj.Recall@10 | Chunks/Query | Total Chunks |',
  );
  console.log(
    '|--------|---------|----------|----------|---------------|--------------|--------------|',
  );

  for (const lambda of lambdas) {
    // Override lambda via env var (loadConfig reads this fresh each call)
    process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA = String(lambda);

    let sourceVector = 0;
    let sourceKeyword = 0;
    let sourceCluster = 0;
    let sourceTotal = 0;
    let adjacentRecallHits = 0;
    let adjacentRecallTotal = 0;
    let totalChunksReturned = 0;

    for (const queryChunk of sample) {
      const result = await searchContext({
        query: queryChunk.content.slice(0, 500),
        projectFilter: queryChunk.session_slug,
        maxTokens: 10000,
        vectorSearchLimit: 20,
      });

      for (const chunk of result.chunks) {
        sourceTotal++;
        if (chunk.source === 'vector') sourceVector++;
        else if (chunk.source === 'keyword') sourceKeyword++;
        else if (chunk.source === 'cluster') sourceCluster++;
      }
      totalChunksReturned += result.chunks.length;

      // Check adjacent recall: did the next chunk in the chain appear?
      const forwardEdges = getForwardEdges(queryChunk.id);
      if (forwardEdges.length > 0) {
        const adjacentId = forwardEdges[0].targetChunkId;
        const resultIds = result.chunks.map((c) => c.id).slice(0, 10);
        if (resultIds.includes(adjacentId)) {
          adjacentRecallHits++;
        }
        adjacentRecallTotal++;
      }
    }

    const vectorPct = sourceTotal > 0 ? ((sourceVector / sourceTotal) * 100).toFixed(0) : '0';
    const keywordPct = sourceTotal > 0 ? ((sourceKeyword / sourceTotal) * 100).toFixed(0) : '0';
    const clusterPct = sourceTotal > 0 ? ((sourceCluster / sourceTotal) * 100).toFixed(0) : '0';
    const adjRecall =
      adjacentRecallTotal > 0
        ? ((adjacentRecallHits / adjacentRecallTotal) * 100).toFixed(0)
        : 'N/A';
    const avgChunks = sample.length > 0 ? (totalChunksReturned / sample.length).toFixed(1) : '0';

    console.log(
      `| ${lambda.toFixed(1).padStart(4)}   | ${vectorPct.padStart(5)}%  | ${keywordPct.padStart(6)}%  | ${clusterPct.padStart(6)}%  | ${adjRecall.padStart(11)}%  | ${avgChunks.padStart(10)}   | ${String(sourceTotal).padStart(10)}   |`,
    );
  }

  // Clean up env var
  delete process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA;

  console.log('\nNotes:');
  console.log('- Lambda 1.0 = pure relevance (no diversity, equivalent to pre-MMR)');
  console.log('- Lambda 0.0 = pure diversity (max novelty, relevance ignored)');
  console.log('- Cluster siblings are scored at parent_score * (1 - cluster_distance)');
  console.log('- MMR lambda alone controls diversity vs relevance tradeoff');
  console.log('- Adj.Recall@10 should not drop significantly from lambda=1.0 baseline');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
