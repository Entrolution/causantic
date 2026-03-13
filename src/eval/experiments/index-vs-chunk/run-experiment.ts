/**
 * Index vs Chunk Retrieval Benchmark
 *
 * Compares search quality when using the semantic index layer vs
 * direct chunk search, using LLM-generated natural language queries.
 *
 * Steps:
 *   1. Sample chunks across diverse clusters
 *   2. Generate natural language search queries via LLM
 *   3. Run each query through both search paths (index + chunk)
 *   4. Compare recall@K, MRR, latency
 *
 * Usage:
 *   npx tsx src/eval/experiments/index-vs-chunk/run-experiment.ts [--sample-size N]
 */

import { writeFileSync } from 'fs';
import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  dereferenceToChunkIds,
  searchIndexEntriesByKeyword,
} from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { KeywordStore } from '../../../storage/keyword-store.js';
import { fuseRRF, type RankedItem } from '../../../retrieval/rrf.js';
import { generateSearchQueries, type ChunkForQueryGen } from './query-generator.js';
import type { QueryResult, PathMetrics, IndexVsChunkReport } from './types.js';

/** Seeded PRNG for reproducible sampling. */
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Sample chunks across diverse clusters.
 * Takes 1-2 chunks per cluster to ensure diversity.
 */
function sampleChunks(sampleSize: number, seed: number): ChunkForQueryGen[] {
  getDb(); // ensure init

  const clusters = getAllClusters();
  if (clusters.length === 0) {
    throw new Error('No clusters found. Run clustering first.');
  }

  const rng = createRng(seed);
  const result: ChunkForQueryGen[] = [];

  // Shuffle clusters
  const shuffled = [...clusters].sort(() => rng() - 0.5);

  for (const cluster of shuffled) {
    if (result.length >= sampleSize) break;

    const chunkIds = getClusterChunkIds(cluster.id);
    if (chunkIds.length < 2) continue;

    // Pick 1-2 random chunks from this cluster
    const numPicks = Math.min(2, Math.ceil(sampleSize / clusters.length), chunkIds.length);
    const shuffledIds = [...chunkIds].sort(() => rng() - 0.5);

    for (let i = 0; i < numPicks && result.length < sampleSize; i++) {
      const chunk = getChunkById(shuffledIds[i]);
      if (!chunk || chunk.content.length < 100) continue;

      result.push({
        id: chunk.id,
        sessionSlug: chunk.sessionSlug,
        content: chunk.content,
        clusterId: cluster.id,
        clusterName: cluster.name,
      });
    }
  }

  return result;
}

/**
 * Search using the index-based path (index entry embeddings + FTS).
 * Returns ranked chunk IDs.
 */
async function searchViaIndex(
  queryEmbedding: number[],
  queryText: string,
  vectorSearchLimit: number,
  hybridSearch: {
    keywordSearchLimit: number;
    vectorWeight: number;
    keywordWeight: number;
    rrfK: number;
  },
): Promise<string[]> {
  const runtimeConfig = toRuntimeConfig(loadConfig());
  indexVectorStore.setModelId(runtimeConfig.embeddingModel);

  // Scale search limit by entries-per-chunk ratio so the index path
  // covers roughly the same number of unique chunks as the chunk path.
  const entryCount = getIndexEntryCount();
  const indexedChunks = getIndexedChunkCount();
  const entriesPerChunk = indexedChunks > 0 ? entryCount / indexedChunks : 1;
  const indexSearchLimit = Math.ceil(vectorSearchLimit * entriesPerChunk);

  const indexSimilar = await indexVectorStore.search(queryEmbedding, indexSearchLimit);

  let indexKeywordResults: Array<{ id: string; score: number }> = [];
  try {
    indexKeywordResults = searchIndexEntriesByKeyword(queryText, hybridSearch.keywordSearchLimit);
  } catch {
    // FTS unavailable
  }

  if (indexSimilar.length === 0 && indexKeywordResults.length === 0) return [];

  const indexVectorItems: RankedItem[] = indexSimilar.map((s) => ({
    chunkId: s.id,
    score: Math.max(0, 1 - s.distance),
    source: 'vector' as const,
  }));

  const indexKeywordItems: RankedItem[] = indexKeywordResults.map((r) => ({
    chunkId: r.id,
    score: r.score,
    source: 'keyword' as const,
  }));

  const indexFused = fuseRRF(
    [
      { items: indexVectorItems, weight: hybridSearch.vectorWeight },
      ...(indexKeywordItems.length > 0
        ? [{ items: indexKeywordItems, weight: hybridSearch.keywordWeight }]
        : []),
    ],
    hybridSearch.rrfK,
  );

  // Dereference to chunk IDs
  const allChunkIds: string[] = [];
  for (const item of indexFused) {
    const chunkIds = dereferenceToChunkIds([item.chunkId]);
    for (const cid of chunkIds) {
      if (!allChunkIds.includes(cid)) {
        allChunkIds.push(cid);
      }
    }
  }

  return allChunkIds;
}

/**
 * Search using the chunk-based path (chunk embeddings + FTS).
 * Returns ranked chunk IDs.
 */
async function searchViaChunks(
  queryEmbedding: number[],
  queryText: string,
  vectorSearchLimit: number,
  hybridSearch: {
    keywordSearchLimit: number;
    vectorWeight: number;
    keywordWeight: number;
    rrfK: number;
  },
): Promise<string[]> {
  const runtimeConfig = toRuntimeConfig(loadConfig());
  vectorStore.setModelId(runtimeConfig.embeddingModel);

  const similar = await vectorStore.search(queryEmbedding, vectorSearchLimit);

  let keywordResults: Array<{ id: string; score: number }> = [];
  try {
    const keywordStore = new KeywordStore();
    keywordResults = keywordStore.search(queryText, hybridSearch.keywordSearchLimit);
  } catch {
    // FTS unavailable
  }

  if (similar.length === 0 && keywordResults.length === 0) return [];

  const vectorItems: RankedItem[] = similar.map((s) => ({
    chunkId: s.id,
    score: Math.max(0, 1 - s.distance),
    source: 'vector' as const,
  }));

  const keywordItems: RankedItem[] = keywordResults.map((r) => ({
    chunkId: r.id,
    score: r.score,
    source: 'keyword' as const,
  }));

  const fused = fuseRRF(
    [
      { items: vectorItems, weight: hybridSearch.vectorWeight },
      ...(keywordItems.length > 0
        ? [{ items: keywordItems, weight: hybridSearch.keywordWeight }]
        : []),
    ],
    hybridSearch.rrfK,
  );

  return fused.map((r) => r.chunkId);
}

/**
 * Compute metrics from per-query results.
 */
function computeMetrics(results: QueryResult[], path: 'index' | 'chunk'): PathMetrics {
  const ranks = results.map((r) => r[path].rank);
  const durations = results.map((r) => r[path].durationMs);

  const recallAtK = (k: number) => ranks.filter((r) => r > 0 && r <= k).length / ranks.length;

  const mrr = ranks.filter((r) => r > 0).reduce((sum, r) => sum + 1 / r, 0) / ranks.length;

  const hitRate = ranks.filter((r) => r > 0).length / ranks.length;

  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianLatency =
    sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
  const meanLatency =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return {
    recallAt5: recallAtK(5),
    recallAt10: recallAtK(10),
    recallAt20: recallAtK(20),
    mrr,
    hitRate,
    meanLatencyMs: meanLatency,
    medianLatencyMs: medianLatency,
  };
}

function fmt(n: number, d = 3): string {
  return n.toFixed(d);
}

/**
 * Run the full A/B benchmark.
 */
async function runBenchmark(): Promise<IndexVsChunkReport> {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 100;
  const seed = 42;

  console.log('=== Index vs Chunk Retrieval Benchmark ===\n');

  // Check prerequisites
  const _db = getDb();
  const entryCount = getIndexEntryCount();
  console.log(`Index entries: ${entryCount}`);
  if (entryCount === 0) {
    console.log('No index entries. Run backfill first.');
    process.exit(1);
  }

  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);

  // 1. Sample chunks
  console.log(`\nSampling ${sampleSize} chunks across clusters...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(
    `  Sampled ${sampledChunks.length} chunks from ${new Set(sampledChunks.map((c) => c.clusterId)).size} clusters`,
  );

  // 2. Generate search queries
  console.log('\nGenerating natural language search queries via LLM...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(
    `  Generated ${queries.length} queries (${sampledChunks.length - queries.length} failed)`,
  );

  if (queries.length === 0) {
    console.log('No queries generated. Check API key.');
    process.exit(1);
  }

  // 3. Prepare embedder
  const embedder = new Embedder();
  await embedder.load(getModel(config.embeddingModel));

  const hybridSearch = config.hybridSearch;
  const vectorSearchLimit = 20;

  // 4. Run queries through both paths
  console.log(`\nRunning ${queries.length} queries through both search paths...`);
  const perQuery: QueryResult[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if ((i + 1) % 10 === 0 || i === queries.length - 1) {
      console.log(`  Query ${i + 1}/${queries.length}`);
    }

    // Embed query
    const embedResult = await embedder.embed(q.query, true);
    const queryEmbedding = embedResult.embedding;

    // Index path
    const indexStart = Date.now();
    const indexResults = await searchViaIndex(
      queryEmbedding,
      q.query,
      vectorSearchLimit,
      hybridSearch,
    );
    const indexDuration = Date.now() - indexStart;

    // Chunk path
    const chunkStart = Date.now();
    const chunkResults = await searchViaChunks(
      queryEmbedding,
      q.query,
      vectorSearchLimit,
      hybridSearch,
    );
    const chunkDuration = Date.now() - chunkStart;

    // Find rank of ground truth
    const indexRank = indexResults.indexOf(q.groundTruthChunkId) + 1; // 0 = not found
    const chunkRank = chunkResults.indexOf(q.groundTruthChunkId) + 1;

    perQuery.push({
      query: q.query,
      groundTruthChunkId: q.groundTruthChunkId,
      index: {
        rank: indexRank,
        totalReturned: indexResults.length,
        durationMs: indexDuration,
      },
      chunk: {
        rank: chunkRank,
        totalReturned: chunkResults.length,
        durationMs: chunkDuration,
      },
    });
  }

  await embedder.dispose();

  // 5. Compute metrics
  const indexMetrics = computeMetrics(perQuery, 'index');
  const chunkMetrics = computeMetrics(perQuery, 'chunk');

  // 6. Display results
  console.log('\n══ Results ══\n');
  console.log('  Metric          Index Path    Chunk Path    Delta');
  console.log('  ' + '─'.repeat(55));
  console.log(
    `  Recall@5        ${fmt(indexMetrics.recallAt5 * 100, 1)}%        ${fmt(chunkMetrics.recallAt5 * 100, 1)}%        ${fmt((indexMetrics.recallAt5 - chunkMetrics.recallAt5) * 100, 1)}%`,
  );
  console.log(
    `  Recall@10       ${fmt(indexMetrics.recallAt10 * 100, 1)}%        ${fmt(chunkMetrics.recallAt10 * 100, 1)}%        ${fmt((indexMetrics.recallAt10 - chunkMetrics.recallAt10) * 100, 1)}%`,
  );
  console.log(
    `  Recall@20       ${fmt(indexMetrics.recallAt20 * 100, 1)}%        ${fmt(chunkMetrics.recallAt20 * 100, 1)}%        ${fmt((indexMetrics.recallAt20 - chunkMetrics.recallAt20) * 100, 1)}%`,
  );
  console.log(
    `  MRR             ${fmt(indexMetrics.mrr)}          ${fmt(chunkMetrics.mrr)}          ${fmt(indexMetrics.mrr - chunkMetrics.mrr)}`,
  );
  console.log(
    `  Hit Rate        ${fmt(indexMetrics.hitRate * 100, 1)}%        ${fmt(chunkMetrics.hitRate * 100, 1)}%        ${fmt((indexMetrics.hitRate - chunkMetrics.hitRate) * 100, 1)}%`,
  );
  console.log(
    `  Mean Latency    ${fmt(indexMetrics.meanLatencyMs, 0)}ms         ${fmt(chunkMetrics.meanLatencyMs, 0)}ms         ${fmt(indexMetrics.meanLatencyMs - chunkMetrics.meanLatencyMs, 0)}ms`,
  );
  console.log(
    `  Median Latency  ${fmt(indexMetrics.medianLatencyMs, 0)}ms         ${fmt(chunkMetrics.medianLatencyMs, 0)}ms         ${fmt(indexMetrics.medianLatencyMs - chunkMetrics.medianLatencyMs, 0)}ms`,
  );

  // Show examples where paths disagree
  const indexWins = perQuery.filter(
    (q) => q.index.rank > 0 && (q.chunk.rank === 0 || q.index.rank < q.chunk.rank),
  );
  const chunkWins = perQuery.filter(
    (q) => q.chunk.rank > 0 && (q.index.rank === 0 || q.chunk.rank < q.index.rank),
  );
  const ties = perQuery.filter((q) => q.index.rank > 0 && q.index.rank === q.chunk.rank);

  console.log(
    `\n  Path comparison: Index wins ${indexWins.length}, Chunk wins ${chunkWins.length}, Ties ${ties.length}, Both miss ${perQuery.length - indexWins.length - chunkWins.length - ties.length}`,
  );

  if (indexWins.length > 0) {
    console.log('\n  Sample queries where INDEX path wins:');
    for (const q of indexWins.slice(0, 3)) {
      console.log(
        `    "${q.query}" → index rank ${q.index.rank}, chunk rank ${q.chunk.rank || 'miss'}`,
      );
    }
  }
  if (chunkWins.length > 0) {
    console.log('\n  Sample queries where CHUNK path wins:');
    for (const q of chunkWins.slice(0, 3)) {
      console.log(
        `    "${q.query}" → chunk rank ${q.chunk.rank}, index rank ${q.index.rank || 'miss'}`,
      );
    }
  }

  // 7. Summary
  const summary: string[] = [];
  summary.push(
    `Benchmark: ${queries.length} natural language queries across ${new Set(queries.map((q) => q.clusterId)).size} clusters`,
  );

  const recallDelta5 = indexMetrics.recallAt5 - chunkMetrics.recallAt5;
  const mrrDelta = indexMetrics.mrr - chunkMetrics.mrr;

  if (recallDelta5 > 0.05) {
    summary.push(
      `Index path BETTER: +${fmt(recallDelta5 * 100, 1)}% recall@5, +${fmt(mrrDelta, 3)} MRR`,
    );
  } else if (recallDelta5 < -0.05) {
    summary.push(
      `Chunk path BETTER: ${fmt(recallDelta5 * 100, 1)}% recall@5, ${fmt(mrrDelta, 3)} MRR`,
    );
  } else {
    summary.push(
      `Paths comparable: ${fmt(recallDelta5 * 100, 1)}% recall@5 delta, ${fmt(mrrDelta, 3)} MRR delta`,
    );
  }

  summary.push(
    `Index path wins ${indexWins.length}/${perQuery.length} queries, chunk path wins ${chunkWins.length}/${perQuery.length}`,
  );

  console.log('\n══ Summary ══\n');
  for (const line of summary) {
    console.log(`  • ${line}`);
  }

  return {
    timestamp: new Date().toISOString(),
    queryCount: queries.length,
    failedQueryCount: sampledChunks.length - queries.length,
    indexMetrics,
    chunkMetrics,
    perQuery,
    summary,
  };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

runBenchmark()
  .then((report) => {
    const outPath = 'index-vs-chunk-report.json';
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outPath}`);
  })
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
