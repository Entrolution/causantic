/**
 * Embedding Model Comparison Benchmark
 *
 * Compares retrieval quality across different embedding models using the
 * same set of queries and ground-truth chunks. Self-contained — does not
 * require reindexing the vector store for each model.
 *
 * Steps:
 *   1. Sample chunks across diverse clusters
 *   2. Generate natural language search queries via LLM (done once)
 *   3. For each model: embed all chunks + queries, compute cosine rankings
 *   4. Compare recall@K, MRR, hit rate across models
 *
 * Usage:
 *   npx tsx src/eval/experiments/embedding-model-comparison/run-experiment.ts
 *   npx tsx src/eval/experiments/embedding-model-comparison/run-experiment.ts --sample-size=100
 *   npx tsx src/eval/experiments/embedding-model-comparison/run-experiment.ts --models=jina-small,nomic-v1.5,arctic-embed-m
 */

import { writeFileSync } from 'fs';
import { getDb } from '../../../storage/db.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel, getAllModelIds } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { generateSearchQueries, type ChunkForQueryGen } from '../index-vs-chunk/query-generator.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelMetrics {
  modelId: string;
  loadTimeMs: number;
  embedTimeMs: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  mrr: number;
  hitRate: number;
  meanEmbedMs: number;
}

interface QueryResult {
  query: string;
  groundTruthChunkId: string;
  ranks: Record<string, number>; // modelId → rank (0 = miss)
}

interface ComparisonReport {
  timestamp: string;
  sampleSize: number;
  queryCount: number;
  corpusSize: number;
  models: ModelMetrics[];
  perQuery: QueryResult[];
  headToHead: Record<string, Record<string, number>>; // modelA → modelB → win count
}

// ── Helpers ────────────────────────────────────────────────────────────────

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function sampleChunks(sampleSize: number, seed: number): ChunkForQueryGen[] {
  getDb();
  const clusters = getAllClusters();
  if (clusters.length === 0) {
    throw new Error('No clusters found. Run clustering first.');
  }

  const rng = createRng(seed);
  const result: ChunkForQueryGen[] = [];
  const shuffled = [...clusters].sort(() => rng() - 0.5);

  for (const cluster of shuffled) {
    if (result.length >= sampleSize) break;
    const chunkIds = getClusterChunkIds(cluster.id);
    if (chunkIds.length < 2) continue;

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

function computeMetrics(ranks: number[]): {
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  mrr: number;
  hitRate: number;
} {
  const recallAtK = (k: number) => ranks.filter((r) => r > 0 && r <= k).length / ranks.length;
  const mrr = ranks.filter((r) => r > 0).reduce((sum, r) => sum + 1 / r, 0) / ranks.length;
  const hitRate = ranks.filter((r) => r > 0).length / ranks.length;

  return {
    recallAt1: recallAtK(1),
    recallAt5: recallAtK(5),
    recallAt10: recallAtK(10),
    recallAt20: recallAtK(20),
    mrr,
    hitRate,
  };
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runBenchmark(): Promise<ComparisonReport> {
  const args = process.argv.slice(2);

  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 100;

  const modelsArg = args.find((a) => a.startsWith('--models='));
  const modelIds = modelsArg
    ? modelsArg.split('=')[1].split(',')
    : ['jina-small', 'nomic-v1.5', 'arctic-embed-m'];

  const seed = 42;

  console.log('=== Embedding Model Comparison Benchmark ===\n');
  console.log(`Models: ${modelIds.join(', ')}`);

  // Validate model IDs
  const allModels = getAllModelIds();
  for (const id of modelIds) {
    if (!allModels.includes(id)) {
      console.error(`Unknown model: ${id}. Available: ${allModels.join(', ')}`);
      process.exit(1);
    }
  }

  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);

  // 1. Sample chunks
  console.log(`\nSampling ${sampleSize} chunks across clusters...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(
    `  Sampled ${sampledChunks.length} chunks from ${new Set(sampledChunks.map((c) => c.clusterId)).size} clusters`,
  );

  // 2. Generate search queries (once, model-independent)
  console.log('\nGenerating natural language search queries via LLM...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(
    `  Generated ${queries.length} queries (${sampledChunks.length - queries.length} failed)`,
  );

  if (queries.length === 0) {
    console.error('No queries generated. Check API key.');
    process.exit(1);
  }

  // Build ground truth chunk content map
  const chunkContentMap = new Map<string, string>();
  for (const q of queries) {
    const chunk = getChunkById(q.groundTruthChunkId);
    if (chunk) chunkContentMap.set(chunk.id, chunk.content);
  }

  // Also gather a corpus of distractor chunks for ranking
  // Use all sampled chunks as the search corpus
  for (const sc of sampledChunks) {
    if (!chunkContentMap.has(sc.id)) {
      chunkContentMap.set(sc.id, sc.content);
    }
  }

  const corpusIds = [...chunkContentMap.keys()];

  console.log(`  Corpus size: ${corpusIds.length} chunks`);

  // 3. Benchmark each model
  const embedder = new Embedder();
  const allModelMetrics: ModelMetrics[] = [];
  const perQuery: QueryResult[] = queries.map((q) => ({
    query: q.query,
    groundTruthChunkId: q.groundTruthChunkId,
    ranks: {},
  }));

  for (const modelId of modelIds) {
    console.log(`\n── Model: ${modelId} ──`);

    // Load model
    const modelConfig = getModel(modelId);
    const loadStats = await embedder.load(modelConfig);
    console.log(
      `  Loaded in ${fmt(loadStats.loadTimeMs, 0)}ms (${fmt(loadStats.heapUsedMB, 1)} MB heap)`,
    );
    console.log(`  context: ${modelConfig.contextTokens} tokens, pooling: ${modelConfig.pooling}`);

    // Truncate corpus to model's context window (~4 chars/token).
    // This keeps memory bounded (avoids O(seq_len²) attention blowup)
    // and ensures a fair comparison at each model's native capacity.
    const maxChars = Math.min(modelConfig.contextTokens, 512) * 4;
    const corpusTexts = corpusIds.map((id) => {
      const text = chunkContentMap.get(id)!;
      return text.length > maxChars ? text.slice(0, maxChars) : text;
    });

    // Embed corpus one-at-a-time to keep memory bounded
    console.log(`  Embedding ${corpusTexts.length} corpus chunks...`);
    const corpusStart = performance.now();
    const corpusEmbeddings: number[][] = [];
    for (let i = 0; i < corpusTexts.length; i++) {
      if ((i + 1) % 25 === 0) console.log(`    Chunk ${i + 1}/${corpusTexts.length}`);
      const result = await embedder.embed(corpusTexts[i], false);
      corpusEmbeddings.push(result.embedding);
    }
    const corpusEmbedMs = performance.now() - corpusStart;
    console.log(
      `  Corpus embedded in ${fmt(corpusEmbedMs, 0)}ms (${fmt(corpusEmbedMs / corpusTexts.length, 1)}ms/chunk)`,
    );

    // Embed queries and rank
    console.log(`  Running ${queries.length} queries...`);
    const queryStart = performance.now();
    const ranks: number[] = [];
    let totalEmbedMs = 0;

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      if ((i + 1) % 50 === 0 || i === queries.length - 1) {
        console.log(`    Query ${i + 1}/${queries.length}`);
      }

      const embedResult = await embedder.embed(q.query, true);
      totalEmbedMs += embedResult.inferenceMs;

      // Rank all corpus chunks by cosine similarity
      const similarities = corpusIds.map((id, j) => ({
        id,
        sim: cosineSimilarity(embedResult.embedding, corpusEmbeddings[j]),
      }));
      similarities.sort((a, b) => b.sim - a.sim);

      const rank = similarities.findIndex((s) => s.id === q.groundTruthChunkId) + 1;
      ranks.push(rank);
      perQuery[i].ranks[modelId] = rank;
    }

    const queryMs = performance.now() - queryStart;

    // Compute metrics
    const metrics = computeMetrics(ranks);
    const modelMetrics: ModelMetrics = {
      modelId,
      loadTimeMs: loadStats.loadTimeMs,
      embedTimeMs: corpusEmbedMs + queryMs,
      meanEmbedMs: totalEmbedMs / queries.length,
      ...metrics,
    };
    allModelMetrics.push(modelMetrics);

    console.log(
      `  Recall@1: ${fmt(metrics.recallAt1 * 100)}% | Recall@5: ${fmt(metrics.recallAt5 * 100)}% | MRR: ${fmt(metrics.mrr, 3)} | Hit@20: ${fmt(metrics.hitRate * 100)}%`,
    );

    await embedder.dispose();
  }

  // 4. Display comparison
  console.log('\n══ Results ══\n');

  // Header
  const colW = 14;
  const metricCol = 16;
  const header = 'Metric'.padEnd(metricCol) + modelIds.map((m) => m.padStart(colW)).join('');
  console.log(`  ${header}`);
  console.log(`  ${'─'.repeat(metricCol + modelIds.length * colW)}`);

  const rows: [string, (m: ModelMetrics) => string][] = [
    ['Recall@1', (m) => `${fmt(m.recallAt1 * 100)}%`],
    ['Recall@5', (m) => `${fmt(m.recallAt5 * 100)}%`],
    ['Recall@10', (m) => `${fmt(m.recallAt10 * 100)}%`],
    ['Recall@20', (m) => `${fmt(m.recallAt20 * 100)}%`],
    ['MRR', (m) => fmt(m.mrr, 3)],
    ['Hit Rate', (m) => `${fmt(m.hitRate * 100)}%`],
    ['Load (ms)', (m) => fmt(m.loadTimeMs, 0)],
    ['Embed (ms/q)', (m) => fmt(m.meanEmbedMs, 1)],
  ];

  for (const [label, fn] of rows) {
    const values = allModelMetrics.map((m) => fn(m).padStart(colW)).join('');
    console.log(`  ${label.padEnd(metricCol)}${values}`);
  }

  // Head-to-head
  const headToHead: Record<string, Record<string, number>> = {};
  for (const a of modelIds) {
    headToHead[a] = {};
    for (const b of modelIds) {
      if (a === b) continue;
      headToHead[a][b] = perQuery.filter((q) => {
        const ra = q.ranks[a];
        const rb = q.ranks[b];
        return ra > 0 && (rb === 0 || ra < rb);
      }).length;
    }
  }

  console.log('\n  Head-to-head wins:');
  for (const a of modelIds) {
    for (const b of modelIds) {
      if (a >= b) continue;
      const aWins = headToHead[a][b];
      const bWins = headToHead[b][a];
      const ties = perQuery.filter((q) => q.ranks[a] > 0 && q.ranks[a] === q.ranks[b]).length;
      const bothMiss = perQuery.filter((q) => q.ranks[a] === 0 && q.ranks[b] === 0).length;
      console.log(`    ${a} vs ${b}: ${aWins} / ${bWins} / ${ties} ties / ${bothMiss} both miss`);
    }
  }

  // Best model summary
  const best = [...allModelMetrics].sort((a, b) => b.mrr - a.mrr)[0];
  console.log(`\n  Best MRR: ${best.modelId} (${fmt(best.mrr, 3)})`);

  const report: ComparisonReport = {
    timestamp: new Date().toISOString(),
    sampleSize,
    queryCount: queries.length,
    corpusSize: corpusIds.length,
    models: allModelMetrics,
    perQuery,
    headToHead,
  };

  return report;
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────

runBenchmark()
  .then((report) => {
    const outPath = 'embedding-model-comparison-report.json';
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outPath}`);
  })
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
