/**
 * Jeopardy vs Summary Index Entry Comparison
 *
 * A/B test comparing two index entry generation strategies:
 *   A) Summary-style: "This chunk discusses configuring ESLint..."
 *   B) Jeopardy-style: "How to fix ESLint module resolution with TS path aliases?"
 *
 * For a sample of chunks:
 *   1. Gather existing summary entries + embeddings
 *   2. Generate Jeopardy entries + embed them
 *   3. Generate natural language search queries (independent ground truth)
 *   4. For each query, find the ground truth chunk among all sample entries
 *   5. Compare recall: which entry style is found more often?
 *
 * Usage:
 *   npx tsx src/eval/experiments/index-vs-chunk/jeopardy-experiment.ts [--sample-size N]
 */

import { writeFileSync } from 'fs';
import { getDb } from '../../../storage/db.js';
import { indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import { getIndexEntriesForChunk } from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { cosineSimilarity } from '../../../utils/angular-distance.js';
import { generateSearchQueries, type ChunkForQueryGen } from './query-generator.js';
import { generateJeopardyEntries } from './jeopardy-generator.js';

/** Seeded PRNG. */
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function fmt(n: number, d = 3): string {
  return n.toFixed(d);
}

interface SampleEntry {
  chunkId: string;
  sessionSlug: string;
  clusterId: string;
  clusterName: string | null;
  chunkContent: string;
  /** Existing summary-style entry embedding. */
  summaryEmbedding: number[];
  summaryDescription: string;
  /** Jeopardy-style entry embeddings (one per query target). */
  jeopardyEmbeddings: number[][];
  jeopardyQueries: string[];
}

async function run() {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg
    ? parseInt(sampleSizeArg.split('=')[1], 10)
    : 100;
  const seed = 42;

  console.log('=== Jeopardy vs Summary Index Entry Comparison ===\n');

  const _db = getDb();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);

  // 1. Sample chunks across diverse clusters
  console.log(`Sampling ${sampleSize} chunks...`);
  const clusters = getAllClusters();
  const rng = createRng(seed);
  const shuffled = [...clusters].sort(() => rng() - 0.5);

  const sampledChunks: ChunkForQueryGen[] = [];
  for (const cluster of shuffled) {
    if (sampledChunks.length >= sampleSize) break;
    const chunkIds = getClusterChunkIds(cluster.id);
    if (chunkIds.length < 2) continue;

    const shuffledIds = [...chunkIds].sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(2, shuffledIds.length) && sampledChunks.length < sampleSize; i++) {
      const chunk = getChunkById(shuffledIds[i]);
      if (!chunk || chunk.content.length < 200) continue;
      sampledChunks.push({
        id: chunk.id,
        sessionSlug: chunk.sessionSlug,
        content: chunk.content,
        clusterId: cluster.id,
        clusterName: cluster.name,
      });
    }
  }
  console.log(`  Sampled ${sampledChunks.length} chunks from ${new Set(sampledChunks.map((c) => c.clusterId)).size} clusters`);

  // 2. Load existing summary embeddings
  console.log('\nLoading existing summary entries...');
  const allIndexVectors = await indexVectorStore.getAllVectors();
  const indexEmbMap = new Map(allIndexVectors.map((v) => [v.id, v.embedding]));

  const sampleEntries: SampleEntry[] = [];
  let skippedNoEntry = 0;

  for (const sc of sampledChunks) {
    const entries = getIndexEntriesForChunk(sc.id);
    if (entries.length === 0) { skippedNoEntry++; continue; }

    const entry = entries[0];
    const emb = indexEmbMap.get(entry.id);
    if (!emb) { skippedNoEntry++; continue; }

    sampleEntries.push({
      chunkId: sc.id,
      sessionSlug: sc.sessionSlug,
      clusterId: sc.clusterId,
      clusterName: sc.clusterName,
      chunkContent: sc.content,
      summaryEmbedding: emb,
      summaryDescription: entry.description,
      jeopardyEmbeddings: [],
      jeopardyQueries: [],
    });
  }
  console.log(`  ${sampleEntries.length} chunks with existing summary entries (${skippedNoEntry} skipped)`);

  // 3. Generate Jeopardy entries
  console.log('\nGenerating Jeopardy-style entries via LLM...');
  const jeopardyResults = await generateJeopardyEntries(
    sampleEntries.map((e) => ({ id: e.chunkId, content: e.chunkContent })),
    config.clusterRefreshModel,
    (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`  ${done}/${total} chunks`);
    },
  );

  const jeopardyMap = new Map(jeopardyResults.map((j) => [j.chunkId, j.queries]));
  let jeopardyCount = 0;
  let totalQueries = 0;

  for (const entry of sampleEntries) {
    const queries = jeopardyMap.get(entry.chunkId);
    if (queries && queries.length > 0) {
      entry.jeopardyQueries = queries;
      jeopardyCount++;
      totalQueries += queries.length;
    }
  }
  console.log(`  Generated for ${jeopardyCount}/${sampleEntries.length} chunks (${totalQueries} total queries, avg ${fmt(totalQueries / jeopardyCount, 1)} per chunk)`);

  // Filter to chunks that have both summary and jeopardy entries
  const validEntries = sampleEntries.filter((e) => e.jeopardyQueries.length > 0);
  console.log(`  ${validEntries.length} chunks with both entry types`);

  // 4. Embed Jeopardy entries
  console.log('\nEmbedding Jeopardy entries...');
  const embedder = new Embedder();
  await embedder.load(getModel(config.embeddingModel));

  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i];
    const embeddings: number[][] = [];
    for (const query of entry.jeopardyQueries) {
      const result = await embedder.embed(query, false);
      embeddings.push(result.embedding);
    }
    entry.jeopardyEmbeddings = embeddings;

    if ((i + 1) % 25 === 0 || i === validEntries.length - 1) {
      console.log(`  ${i + 1}/${validEntries.length}`);
    }
  }

  // 5. Generate independent search queries (ground truth)
  console.log('\nGenerating independent search queries (ground truth)...');
  const benchmarkQueries = await generateSearchQueries(
    validEntries.map((e) => ({
      id: e.chunkId,
      sessionSlug: e.sessionSlug,
      content: e.chunkContent,
      clusterId: e.clusterId,
      clusterName: e.clusterName,
    })),
    config.clusterRefreshModel,
  );
  console.log(`  Generated ${benchmarkQueries.length} benchmark queries`);

  // 6. Embed queries and compare
  console.log('\nRunning A/B comparison...\n');

  // Build flat arrays for ranking
  const summaryIndex: Array<{ chunkId: string; embedding: number[] }> = validEntries.map((e) => ({
    chunkId: e.chunkId,
    embedding: e.summaryEmbedding,
  }));

  // For Jeopardy, each chunk may have multiple entries — a query matches if
  // ANY of the chunk's Jeopardy embeddings is the closest
  const jeopardyIndex: Array<{ chunkId: string; embedding: number[] }> = [];
  for (const entry of validEntries) {
    for (const emb of entry.jeopardyEmbeddings) {
      jeopardyIndex.push({ chunkId: entry.chunkId, embedding: emb });
    }
  }

  console.log(`  Summary index: ${summaryIndex.length} entries (1 per chunk)`);
  console.log(`  Jeopardy index: ${jeopardyIndex.length} entries (${fmt(jeopardyIndex.length / validEntries.length, 1)} per chunk)`);

  let summaryHitsAt1 = 0, summaryHitsAt3 = 0, summaryHitsAt5 = 0;
  let jeopardyHitsAt1 = 0, jeopardyHitsAt3 = 0, jeopardyHitsAt5 = 0;
  let summaryMRR = 0, jeopardyMRR = 0;
  let summaryMeanSim = 0, jeopardyMeanSim = 0;
  let queryCount = 0;

  const perQuery: Array<{
    query: string;
    groundTruth: string;
    summaryRank: number;
    summarySim: number;
    jeopardyRank: number;
    jeopardySim: number;
  }> = [];

  for (const bq of benchmarkQueries) {
    const queryResult = await embedder.embed(bq.query, true);
    const queryEmb = queryResult.embedding;

    // Rank in summary index
    const summarySims = summaryIndex.map((e) => ({
      chunkId: e.chunkId,
      sim: cosineSimilarity(queryEmb, e.embedding),
    }));
    summarySims.sort((a, b) => b.sim - a.sim);

    const summaryRank = summarySims.findIndex((s) => s.chunkId === bq.groundTruthChunkId) + 1;
    const summarySim = summarySims.find((s) => s.chunkId === bq.groundTruthChunkId)?.sim ?? 0;

    // Rank in Jeopardy index (best rank across all chunk's entries)
    const jeopardySims = jeopardyIndex.map((e) => ({
      chunkId: e.chunkId,
      sim: cosineSimilarity(queryEmb, e.embedding),
    }));
    // Deduplicate by chunkId: keep best sim per chunk
    const bestByChunk = new Map<string, number>();
    for (const js of jeopardySims) {
      const existing = bestByChunk.get(js.chunkId) ?? -1;
      if (js.sim > existing) bestByChunk.set(js.chunkId, js.sim);
    }
    const jeopardyRanked = [...bestByChunk.entries()]
      .map(([chunkId, sim]) => ({ chunkId, sim }))
      .sort((a, b) => b.sim - a.sim);

    const jeopardyRank = jeopardyRanked.findIndex((s) => s.chunkId === bq.groundTruthChunkId) + 1;
    const jeopardySim = jeopardyRanked.find((s) => s.chunkId === bq.groundTruthChunkId)?.sim ?? 0;

    if (summaryRank === 1) summaryHitsAt1++;
    if (summaryRank > 0 && summaryRank <= 3) summaryHitsAt3++;
    if (summaryRank > 0 && summaryRank <= 5) summaryHitsAt5++;
    if (summaryRank > 0) summaryMRR += 1 / summaryRank;

    if (jeopardyRank === 1) jeopardyHitsAt1++;
    if (jeopardyRank > 0 && jeopardyRank <= 3) jeopardyHitsAt3++;
    if (jeopardyRank > 0 && jeopardyRank <= 5) jeopardyHitsAt5++;
    if (jeopardyRank > 0) jeopardyMRR += 1 / jeopardyRank;

    summaryMeanSim += summarySim;
    jeopardyMeanSim += jeopardySim;
    queryCount++;

    perQuery.push({
      query: bq.query,
      groundTruth: bq.groundTruthChunkId,
      summaryRank,
      summarySim,
      jeopardyRank,
      jeopardySim,
    });
  }

  await embedder.dispose();

  // 7. Display results
  console.log('  Metric              Summary       Jeopardy      Delta');
  console.log('  ' + '─'.repeat(60));
  console.log(
    `  Hit@1 (rank 1)      ${fmt((summaryHitsAt1 / queryCount) * 100, 1)}%         ${fmt((jeopardyHitsAt1 / queryCount) * 100, 1)}%         ${fmt(((jeopardyHitsAt1 - summaryHitsAt1) / queryCount) * 100, 1)}%`,
  );
  console.log(
    `  Hit@3               ${fmt((summaryHitsAt3 / queryCount) * 100, 1)}%         ${fmt((jeopardyHitsAt3 / queryCount) * 100, 1)}%         ${fmt(((jeopardyHitsAt3 - summaryHitsAt3) / queryCount) * 100, 1)}%`,
  );
  console.log(
    `  Hit@5               ${fmt((summaryHitsAt5 / queryCount) * 100, 1)}%         ${fmt((jeopardyHitsAt5 / queryCount) * 100, 1)}%         ${fmt(((jeopardyHitsAt5 - summaryHitsAt5) / queryCount) * 100, 1)}%`,
  );
  console.log(
    `  MRR                 ${fmt(summaryMRR / queryCount)}          ${fmt(jeopardyMRR / queryCount)}          ${fmt((jeopardyMRR - summaryMRR) / queryCount)}`,
  );
  console.log(
    `  Mean cos sim        ${fmt(summaryMeanSim / queryCount)}          ${fmt(jeopardyMeanSim / queryCount)}          ${fmt((jeopardyMeanSim - summaryMeanSim) / queryCount)}`,
  );

  // Head-to-head
  const jeopardyWins = perQuery.filter((q) => q.jeopardyRank > 0 && (q.summaryRank === 0 || q.jeopardyRank < q.summaryRank));
  const summaryWins = perQuery.filter((q) => q.summaryRank > 0 && (q.jeopardyRank === 0 || q.summaryRank < q.jeopardyRank));
  const ties = perQuery.filter((q) => q.summaryRank > 0 && q.summaryRank === q.jeopardyRank);
  const bothMiss = perQuery.filter((q) => q.summaryRank === 0 && q.jeopardyRank === 0);

  console.log(`\n  Head-to-head: Jeopardy wins ${jeopardyWins.length}, Summary wins ${summaryWins.length}, Ties ${ties.length}, Both miss ${bothMiss.length}`);

  if (jeopardyWins.length > 0) {
    console.log('\n  Sample queries where JEOPARDY wins:');
    for (const q of jeopardyWins.slice(0, 5)) {
      console.log(
        `    "${q.query.slice(0, 80)}" → jeopardy rank ${q.jeopardyRank}, summary rank ${q.summaryRank || 'miss'}`,
      );
    }
  }
  if (summaryWins.length > 0) {
    console.log('\n  Sample queries where SUMMARY wins:');
    for (const q of summaryWins.slice(0, 5)) {
      console.log(
        `    "${q.query.slice(0, 80)}" → summary rank ${q.summaryRank}, jeopardy rank ${q.jeopardyRank || 'miss'}`,
      );
    }
  }

  // Summary
  const summary: string[] = [];
  summary.push(`A/B test: ${queryCount} queries, ${validEntries.length} chunks (summary: 1 entry/chunk, jeopardy: ${fmt(jeopardyIndex.length / validEntries.length, 1)} entries/chunk)`);

  const mrrDelta = (jeopardyMRR - summaryMRR) / queryCount;
  if (mrrDelta > 0.02) {
    summary.push(`Jeopardy BETTER: +${fmt(mrrDelta)} MRR, wins ${jeopardyWins.length} vs ${summaryWins.length}`);
  } else if (mrrDelta < -0.02) {
    summary.push(`Summary BETTER: ${fmt(mrrDelta)} MRR, wins ${summaryWins.length} vs ${jeopardyWins.length}`);
  } else {
    summary.push(`Comparable: ${fmt(mrrDelta)} MRR delta, ${jeopardyWins.length} vs ${summaryWins.length} wins`);
  }

  console.log('\n══ Summary ══\n');
  for (const line of summary) {
    console.log(`  • ${line}`);
  }

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    queryCount,
    validChunks: validEntries.length,
    summaryEntriesPerChunk: 1,
    jeopardyEntriesPerChunk: jeopardyIndex.length / validEntries.length,
    summaryMetrics: {
      hitAt1: summaryHitsAt1 / queryCount,
      hitAt3: summaryHitsAt3 / queryCount,
      hitAt5: summaryHitsAt5 / queryCount,
      mrr: summaryMRR / queryCount,
      meanCosSim: summaryMeanSim / queryCount,
    },
    jeopardyMetrics: {
      hitAt1: jeopardyHitsAt1 / queryCount,
      hitAt3: jeopardyHitsAt3 / queryCount,
      hitAt5: jeopardyHitsAt5 / queryCount,
      mrr: jeopardyMRR / queryCount,
      meanCosSim: jeopardyMeanSim / queryCount,
    },
    headToHead: {
      jeopardyWins: jeopardyWins.length,
      summaryWins: summaryWins.length,
      ties: ties.length,
      bothMiss: bothMiss.length,
    },
    perQuery,
    sampleJeopardyEntries: validEntries.slice(0, 5).map((e) => ({
      chunkId: e.chunkId,
      summaryDescription: e.summaryDescription,
      jeopardyQueries: e.jeopardyQueries,
    })),
    summary,
  };

  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

run()
  .then((report) => {
    const outPath = 'jeopardy-vs-summary-report.json';
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outPath}`);
  })
  .catch((err) => {
    console.error('Experiment failed:', err);
    process.exit(1);
  });
