/**
 * Re-scorer Ceiling Analysis
 *
 * Measures how much headroom a second-stage re-scorer would have by answering:
 *   1. At high K values, what % of ground-truth chunks appear in vector search?
 *   2. When found, what's their rank distribution?
 *   3. If a perfect re-scorer promoted every found target to rank 1,
 *      what would budget assembly look like?
 *
 * Tests both raw chunk search and index entry search paths.
 *
 * Usage:
 *   npx tsx src/eval/experiments/rescorer-ceiling/run-experiment.ts [--sample-size=50]
 */

import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  dereferenceToChunkIds,
} from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { generateSearchQueries, type ChunkForQueryGen } from '../index-vs-chunk/query-generator.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface RecallResult {
  found: boolean;
  /** 1-based rank within results, 0 if not found */
  rank: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function sampleChunks(sampleSize: number, seed: number): ChunkForQueryGen[] {
  getDb();
  const clusters = getAllClusters();
  if (clusters.length === 0) throw new Error('No clusters found.');

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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Search functions ───────────────────────────────────────────────────────

async function searchChunkPath(
  embedding: number[],
  targetId: string,
  limit: number,
): Promise<RecallResult> {
  const results = await vectorStore.search(embedding, limit);
  const rank = results.findIndex((r) => r.id === targetId) + 1;
  return { found: rank > 0, rank };
}

async function searchIndexPath(
  embedding: number[],
  targetId: string,
  limit: number,
  entriesPerChunk: number,
): Promise<RecallResult> {
  const indexLimit = Math.ceil(limit * entriesPerChunk);
  const results = await indexVectorStore.search(embedding, indexLimit);

  // Check each result — an index entry may dereference to multiple chunks
  for (let i = 0; i < results.length; i++) {
    const chunkIds = dereferenceToChunkIds([results[i].id]);
    if (chunkIds.includes(targetId)) {
      return { found: true, rank: i + 1 };
    }
  }
  return { found: false, rank: 0 };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runAnalysis() {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 50;
  const seed = 42;

  console.log('=== Re-scorer Ceiling Analysis ===\n');

  getDb();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);
  const maxTokens = config.mcpMaxResponseTokens;

  const useIndex = config.semanticIndex.useForSearch && getIndexEntryCount() > 0;
  let entriesPerChunk = 1;
  if (useIndex) {
    const indexedChunks = getIndexedChunkCount();
    entriesPerChunk = indexedChunks > 0 ? getIndexEntryCount() / indexedChunks : 1;
  }

  console.log(`Search path: ${useIndex ? 'INDEX' : 'CHUNK'}`);
  if (useIndex) console.log(`Entries per chunk: ${entriesPerChunk.toFixed(1)}`);
  console.log(`Max response tokens: ${maxTokens}`);

  vectorStore.setModelId(config.embeddingModel);
  if (useIndex) indexVectorStore.setModelId(config.embeddingModel);

  // 1. Sample and generate queries
  console.log(`\nSampling ${sampleSize} chunks...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(`  Sampled ${sampledChunks.length} chunks`);

  console.log('Generating queries...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(`  Generated ${queries.length} queries`);

  // Get token sizes for budget analysis
  const chunkTokenSizes = new Map<string, number>();
  for (const q of queries) {
    const chunk = getChunkById(q.groundTruthChunkId);
    if (chunk) chunkTokenSizes.set(q.groundTruthChunkId, chunk.approxTokens || 500);
  }

  // 2. Prepare embedder
  const embedder = new Embedder();
  await embedder.load(getModel(config.embeddingModel));

  console.log('Embedding queries...');
  const queryEmbeddings: number[][] = [];
  for (const q of queries) {
    const { embedding } = await embedder.embed(q.query, true);
    queryEmbeddings.push(embedding);
  }
  console.log(`  Embedded ${queryEmbeddings.length} queries\n`);

  // 3. Sweep K values
  const kValues = [50, 100, 200, 500, 1000, 2000];
  console.log(`K values: ${kValues.join(', ')}\n`);

  const resultsByK = new Map<number, { ranks: number[]; misses: number }>();

  for (const k of kValues) {
    const ranks: number[] = [];
    let misses = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      const embedding = queryEmbeddings[qi];

      const result = useIndex
        ? await searchIndexPath(embedding, q.groundTruthChunkId, k, entriesPerChunk)
        : await searchChunkPath(embedding, q.groundTruthChunkId, k);

      if (result.found) {
        ranks.push(result.rank);
      } else {
        misses++;
      }
    }

    resultsByK.set(k, { ranks, misses });

    const total = queries.length;
    const found = ranks.length;
    const recall = ((found / total) * 100).toFixed(1);

    const sortedRanks = [...ranks].sort((a, b) => a - b);
    const p50 = percentile(sortedRanks, 50);
    const p90 = percentile(sortedRanks, 90);
    const p99 = percentile(sortedRanks, 99);

    console.log(`── K=${k} ──`);
    console.log(`  Recall: ${found}/${total} (${recall}%)`);
    if (found > 0) {
      console.log(`  Rank distribution: median=${p50}, p90=${p90}, p99=${p99}, max=${sortedRanks[sortedRanks.length - 1]}`);
    }
  }

  // 4. Budget ceiling analysis
  console.log('\n══ Re-scorer Ceiling (perfect re-ranker) ══\n');
  console.log('If a perfect re-scorer promoted every found target to the top of results,');
  console.log(`how many would fit within the ${maxTokens}-token budget?\n`);

  for (const k of kValues) {
    const { ranks, misses } = resultsByK.get(k)!;
    const total = queries.length;

    // Every found chunk would be promoted to position 1 by a perfect re-scorer
    // so budget is the only constraint
    let fitsInBudget = 0;
    let tooLarge = 0;
    for (let qi = 0; qi < queries.length; qi++) {
      const targetId = queries[qi].groundTruthChunkId;
      const result = useIndex
        ? await searchIndexPath(queryEmbeddings[qi], targetId, k, entriesPerChunk)
        : await searchChunkPath(queryEmbeddings[qi], targetId, k);

      if (!result.found) continue;

      const tokens = chunkTokenSizes.get(targetId) ?? 500;
      if (tokens <= maxTokens) {
        fitsInBudget++;
      } else {
        tooLarge++;
      }
    }

    const ceiling = ((fitsInBudget / total) * 100).toFixed(1);
    const currentBest = resultsByK.get(k)!;
    console.log(`  K=${k}: ceiling=${ceiling}% (${fitsInBudget}/${total})  [recall=${((currentBest.ranks.length / total) * 100).toFixed(1)}%, oversized=${tooLarge}]`);
  }

  // 5. Rank bucket analysis — where do found targets cluster?
  console.log('\n══ Rank Buckets (K=2000) ══\n');
  const best = resultsByK.get(kValues[kValues.length - 1]);
  if (best && best.ranks.length > 0) {
    const buckets = [
      { label: '1-10', min: 1, max: 10 },
      { label: '11-50', min: 11, max: 50 },
      { label: '51-100', min: 51, max: 100 },
      { label: '101-200', min: 101, max: 200 },
      { label: '201-500', min: 201, max: 500 },
      { label: '501-1000', min: 501, max: 1000 },
      { label: '1001-2000', min: 1001, max: 2000 },
    ];

    for (const { label, min, max } of buckets) {
      const count = best.ranks.filter((r) => r >= min && r <= max).length;
      const bar = '█'.repeat(Math.ceil(count / queries.length * 50));
      console.log(`  ${label.padStart(10)}: ${String(count).padStart(3)}  ${bar}`);
    }
    console.log(`  ${'miss'.padStart(10)}: ${String(best.misses).padStart(3)}`);
  }

  await embedder.dispose();
  console.log('\nDone.');
}

runAnalysis().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
