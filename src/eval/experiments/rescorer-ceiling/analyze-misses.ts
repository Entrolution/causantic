/**
 * Miss Population Analysis
 *
 * For chunks that are never found by vector search (even at K=2000),
 * diagnoses why by comparing hit vs miss populations across:
 *
 *   1. Embedding distance: query → chunk embedding, query → best index entry embedding
 *   2. Index entry count per chunk
 *   3. Chunk content length (tokens)
 *   4. Cluster size (competition from similar chunks)
 *   5. Content samples from hits vs misses
 *
 * Usage:
 *   npx tsx src/eval/experiments/rescorer-ceiling/analyze-misses.ts [--sample-size=50]
 */

import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  getIndexEntriesForChunk,
  dereferenceToChunkIds,
} from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { cosineSimilarity } from '../../../utils/angular-distance.js';
import { generateSearchQueries, type ChunkForQueryGen } from '../index-vs-chunk/query-generator.js';

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ChunkProfile {
  chunkId: string;
  query: string;
  found: boolean;
  /** Cosine similarity: query embedding → chunk's own embedding */
  queryToChunkSim: number;
  /** Cosine similarity: query embedding → best index entry embedding */
  queryToBestEntrySim: number;
  /** Number of index entries for this chunk */
  indexEntryCount: number;
  /** Chunk token count */
  chunkTokens: number;
  /** Number of chunks in same cluster */
  clusterSize: number;
  /** Content preview (first 120 chars) */
  contentPreview: string;
  /** Best matching index entry text */
  bestEntryText: string;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runAnalysis() {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 50;
  const seed = 42;
  const K = 2000; // high K for determining hit/miss

  console.log('=== Miss Population Analysis ===\n');

  getDb();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);

  const useIndex = config.semanticIndex.useForSearch && getIndexEntryCount() > 0;
  let entriesPerChunk = 1;
  if (useIndex) {
    const indexedChunks = getIndexedChunkCount();
    entriesPerChunk = indexedChunks > 0 ? getIndexEntryCount() / indexedChunks : 1;
  }

  console.log(`Search path: ${useIndex ? 'INDEX' : 'CHUNK'}`);
  console.log(`K: ${K}`);

  vectorStore.setModelId(config.embeddingModel);
  if (useIndex) indexVectorStore.setModelId(config.embeddingModel);

  // Build cluster size map
  const clusterSizeMap = new Map<string, number>();
  for (const cluster of getAllClusters()) {
    const chunkIds = getClusterChunkIds(cluster.id);
    for (const cid of chunkIds) {
      clusterSizeMap.set(cid, chunkIds.length);
    }
  }

  // 1. Sample and generate queries
  console.log(`\nSampling ${sampleSize} chunks...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(`  Sampled ${sampledChunks.length} chunks`);

  console.log('Generating queries...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(`  Generated ${queries.length} queries`);

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

  // 3. Profile each query-chunk pair
  const profiles: ChunkProfile[] = [];

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const queryEmb = queryEmbeddings[qi];
    const targetId = q.groundTruthChunkId;

    // Determine hit/miss at K=2000
    let found = false;
    if (useIndex) {
      const indexLimit = Math.ceil(K * entriesPerChunk);
      const results = await indexVectorStore.search(queryEmb, indexLimit);
      for (const r of results) {
        const chunkIds = dereferenceToChunkIds([r.id]);
        if (chunkIds.includes(targetId)) {
          found = true;
          break;
        }
      }
    } else {
      const results = await vectorStore.search(queryEmb, K);
      found = results.some((r) => r.id === targetId);
    }

    // Get chunk's own embedding
    const chunkEmb = await vectorStore.get(targetId);
    const queryToChunkSim = chunkEmb ? cosineSimilarity(queryEmb, chunkEmb) : -1;

    // Get index entry embeddings and find best match
    const entries = getIndexEntriesForChunk(targetId);
    let queryToBestEntrySim = -1;
    let bestEntryText = '(no entries)';

    for (const entry of entries) {
      const entryEmb = await indexVectorStore.get(entry.id);
      if (entryEmb) {
        const sim = cosineSimilarity(queryEmb, entryEmb);
        if (sim > queryToBestEntrySim) {
          queryToBestEntrySim = sim;
          bestEntryText = entry.description;
        }
      }
    }

    const chunk = getChunkById(targetId);

    profiles.push({
      chunkId: targetId,
      query: q.query,
      found,
      queryToChunkSim,
      queryToBestEntrySim,
      indexEntryCount: entries.length,
      chunkTokens: chunk?.approxTokens ?? 0,
      clusterSize: clusterSizeMap.get(targetId) ?? 0,
      contentPreview: (chunk?.content ?? '').slice(0, 120).replace(/\n/g, ' '),
      bestEntryText,
    });
  }

  // 4. Split into hits vs misses and compare
  const hits = profiles.filter((p) => p.found);
  const misses = profiles.filter((p) => !p.found);

  console.log(`══ Population Summary ══\n`);
  console.log(`  Hits:   ${hits.length}/${profiles.length}`);
  console.log(`  Misses: ${misses.length}/${profiles.length}\n`);

  console.log(`══ Embedding Distance Comparison ══\n`);
  console.log('  Query → Chunk embedding (cosine similarity):');
  console.log(
    `    Hits:   mean=${mean(hits.map((p) => p.queryToChunkSim)).toFixed(3)}  median=${median(hits.map((p) => p.queryToChunkSim)).toFixed(3)}`,
  );
  console.log(
    `    Misses: mean=${mean(misses.map((p) => p.queryToChunkSim)).toFixed(3)}  median=${median(misses.map((p) => p.queryToChunkSim)).toFixed(3)}`,
  );

  console.log('\n  Query → Best index entry embedding (cosine similarity):');
  console.log(
    `    Hits:   mean=${mean(hits.map((p) => p.queryToBestEntrySim)).toFixed(3)}  median=${median(hits.map((p) => p.queryToBestEntrySim)).toFixed(3)}`,
  );
  console.log(
    `    Misses: mean=${mean(misses.map((p) => p.queryToBestEntrySim)).toFixed(3)}  median=${median(misses.map((p) => p.queryToBestEntrySim)).toFixed(3)}`,
  );

  console.log(`\n══ Index Entry Count ══\n`);
  console.log(
    `    Hits:   mean=${mean(hits.map((p) => p.indexEntryCount)).toFixed(1)}  median=${median(hits.map((p) => p.indexEntryCount))}`,
  );
  console.log(
    `    Misses: mean=${mean(misses.map((p) => p.indexEntryCount)).toFixed(1)}  median=${median(misses.map((p) => p.indexEntryCount))}`,
  );

  console.log(`\n══ Chunk Size (tokens) ══\n`);
  console.log(
    `    Hits:   mean=${mean(hits.map((p) => p.chunkTokens)).toFixed(0)}  median=${median(hits.map((p) => p.chunkTokens))}`,
  );
  console.log(
    `    Misses: mean=${mean(misses.map((p) => p.chunkTokens)).toFixed(0)}  median=${median(misses.map((p) => p.chunkTokens))}`,
  );

  console.log(`\n══ Cluster Size ══\n`);
  console.log(
    `    Hits:   mean=${mean(hits.map((p) => p.clusterSize)).toFixed(1)}  median=${median(hits.map((p) => p.clusterSize))}`,
  );
  console.log(
    `    Misses: mean=${mean(misses.map((p) => p.clusterSize)).toFixed(1)}  median=${median(misses.map((p) => p.clusterSize))}`,
  );

  // 5. Similarity distribution buckets
  console.log(`\n══ Best Entry Similarity Distribution ══\n`);
  const simBuckets = [
    { label: '0.9-1.0', min: 0.9, max: 1.0 },
    { label: '0.8-0.9', min: 0.8, max: 0.9 },
    { label: '0.7-0.8', min: 0.7, max: 0.8 },
    { label: '0.6-0.7', min: 0.6, max: 0.7 },
    { label: '0.5-0.6', min: 0.5, max: 0.6 },
    { label: '0.4-0.5', min: 0.4, max: 0.5 },
    { label: '<0.4', min: -1, max: 0.4 },
  ];

  console.log('  Bucket      Hits  Misses');
  console.log('  ─────────────────────────');
  for (const { label, min, max } of simBuckets) {
    const hitCount = hits.filter(
      (p) => p.queryToBestEntrySim >= min && p.queryToBestEntrySim < max,
    ).length;
    const missCount = misses.filter(
      (p) => p.queryToBestEntrySim >= min && p.queryToBestEntrySim < max,
    ).length;
    console.log(
      `  ${label.padStart(7)}    ${String(hitCount).padStart(4)}  ${String(missCount).padStart(6)}`,
    );
  }

  // 6. Sample misses for qualitative review
  console.log(`\n══ Sample Misses (worst by entry similarity) ══\n`);
  const sortedMisses = [...misses].sort((a, b) => a.queryToBestEntrySim - b.queryToBestEntrySim);
  const samplesToShow = Math.min(10, sortedMisses.length);

  for (let i = 0; i < samplesToShow; i++) {
    const p = sortedMisses[i];
    console.log(
      `  [${i + 1}] chunk=${p.chunkId.slice(0, 12)}… sim_chunk=${p.queryToChunkSim.toFixed(3)} sim_entry=${p.queryToBestEntrySim.toFixed(3)} entries=${p.indexEntryCount}`,
    );
    console.log(`      Query: ${p.query}`);
    console.log(`      Entry: ${p.bestEntryText}`);
    console.log(`      Chunk: ${p.contentPreview}…`);
    console.log();
  }

  // 7. Sample hits for comparison
  console.log(`══ Sample Hits (best by entry similarity) ══\n`);
  const sortedHits = [...hits].sort((a, b) => b.queryToBestEntrySim - a.queryToBestEntrySim);
  const hitSamplesToShow = Math.min(5, sortedHits.length);

  for (let i = 0; i < hitSamplesToShow; i++) {
    const p = sortedHits[i];
    console.log(
      `  [${i + 1}] chunk=${p.chunkId.slice(0, 12)}… sim_chunk=${p.queryToChunkSim.toFixed(3)} sim_entry=${p.queryToBestEntrySim.toFixed(3)} entries=${p.indexEntryCount}`,
    );
    console.log(`      Query: ${p.query}`);
    console.log(`      Entry: ${p.bestEntryText}`);
    console.log();
  }

  await embedder.dispose();
  console.log('Done.');
}

runAnalysis().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
