/**
 * Sweep minWeight threshold to find optimal value.
 *
 * Tests different minWeight values and measures:
 * - Augmentation: additional chunks found via graph traversal
 * - Paths explored: computational cost
 * - Weight distribution: how weights are distributed across results
 */

import { vectorStore } from '../src/storage/vector-store.js';
import { traverseMultiple } from '../src/retrieval/traverser.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { closeDb } from '../src/storage/db.js';

const TEST_QUERIES = [
  'vector clock decay curves',
  'HDBSCAN clustering algorithm',
  'file path reference parsing',
  'semantic embedding retrieval',
  'MCP server implementation',
  'TypeScript error handling',
  'database schema migration',
  'session ingestion pipeline',
  'edge weight calculation',
  'chunk boundary detection',
];

const MIN_WEIGHTS = [0.1, 0.05, 0.01, 0.005, 0.001, 0.0005, 0.0001];
const MAX_DEPTH = 20;

interface SweepResult {
  minWeight: number;
  avgChunksAdded: number;
  avgPathsExplored: number;
  avgMaxWeight: number;
  avgMedianWeight: number;
  avgMinWeight: number;
  totalTimeMs: number;
}

async function runSweep(embedder: Embedder): Promise<SweepResult[]> {
  const results: SweepResult[] = [];

  for (const minWeight of MIN_WEIGHTS) {
    console.log(`\nTesting minWeight = ${minWeight}...`);

    let totalChunksAdded = 0;
    let totalPathsExplored = 0;
    let totalMaxWeight = 0;
    let totalMedianWeight = 0;
    let totalMinWeight = 0;
    const startTime = Date.now();

    for (const query of TEST_QUERIES) {
      process.stdout.write('  ' + query.slice(0, 30) + '... ');

      // Get vector search results
      const { embedding } = await embedder.embed(query, true);
      const vectorResults = await vectorStore.search(embedding, 10);
      const vectorChunkIds = new Set(vectorResults.map((r) => r.id));

      const startIds = vectorResults.map((r) => r.id);

      // Traverse backward
      const backwardResult = traverseMultiple(startIds, {
        direction: 'backward',
        maxDepth: MAX_DEPTH,
        minWeight,
      });

      // Traverse forward
      const forwardResult = traverseMultiple(startIds, {
        direction: 'forward',
        maxDepth: MAX_DEPTH,
        minWeight,
      });

      // Combine and dedupe
      const allChunks = [...backwardResult.chunks, ...forwardResult.chunks];
      const newChunks = allChunks.filter((c) => !vectorChunkIds.has(c.chunkId));
      const weights = newChunks.map((c) => c.weight).sort((a, b) => b - a);

      totalChunksAdded += newChunks.length;
      totalPathsExplored += backwardResult.visited + forwardResult.visited;

      if (weights.length > 0) {
        totalMaxWeight += weights[0];
        totalMedianWeight += weights[Math.floor(weights.length / 2)];
        totalMinWeight += weights[weights.length - 1];
      }

      console.log(
        `+${newChunks.length} chunks, ${backwardResult.visited + forwardResult.visited} paths`,
      );
    }

    const elapsed = Date.now() - startTime;
    const n = TEST_QUERIES.length;

    results.push({
      minWeight,
      avgChunksAdded: totalChunksAdded / n,
      avgPathsExplored: totalPathsExplored / n,
      avgMaxWeight: totalMaxWeight / n,
      avgMedianWeight: totalMedianWeight / n,
      avgMinWeight: totalMinWeight / n,
      totalTimeMs: elapsed,
    });
  }

  return results;
}

function printResults(results: SweepResult[]) {
  console.log('\n' + '='.repeat(100));
  console.log('MIN WEIGHT SWEEP RESULTS');
  console.log('='.repeat(100));

  console.log(
    '\nminWeight   | Chunks Added | Paths Explored | Max Weight | Median Weight | Min Weight | Time (ms)',
  );
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      String(r.minWeight).padEnd(11) +
        ' | ' +
        r.avgChunksAdded.toFixed(1).padStart(12) +
        ' | ' +
        r.avgPathsExplored.toFixed(0).padStart(14) +
        ' | ' +
        r.avgMaxWeight.toFixed(4).padStart(10) +
        ' | ' +
        r.avgMedianWeight.toFixed(4).padStart(13) +
        ' | ' +
        r.avgMinWeight.toFixed(4).padStart(10) +
        ' | ' +
        String(r.totalTimeMs).padStart(9),
    );
  }

  console.log('\n' + '='.repeat(100));
  console.log('ANALYSIS');
  console.log('='.repeat(100));

  // Find diminishing returns point
  console.log('\nDiminishing returns analysis:');
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    const chunkIncrease = ((curr.avgChunksAdded - prev.avgChunksAdded) / prev.avgChunksAdded) * 100;
    const pathIncrease =
      ((curr.avgPathsExplored - prev.avgPathsExplored) / prev.avgPathsExplored) * 100;
    const efficiency = chunkIncrease / pathIncrease;

    console.log(
      `  ${prev.minWeight} → ${curr.minWeight}: ` +
        `+${chunkIncrease.toFixed(1)}% chunks, ` +
        `+${pathIncrease.toFixed(1)}% paths, ` +
        `efficiency: ${efficiency.toFixed(2)}`,
    );
  }

  // Recommendation
  console.log('\nRecommendation:');
  let bestIdx = 0;
  let bestEfficiency = 0;
  for (let i = 0; i < results.length - 1; i++) {
    const curr = results[i];
    const next = results[i + 1];
    const efficiency =
      next.avgChunksAdded / next.avgPathsExplored / (curr.avgChunksAdded / curr.avgPathsExplored);
    if (efficiency > bestEfficiency && next.avgChunksAdded > curr.avgChunksAdded) {
      bestEfficiency = efficiency;
      bestIdx = i + 1;
    }
  }

  console.log(`  Best efficiency at minWeight = ${results[bestIdx].minWeight}`);
  console.log(
    `  (${results[bestIdx].avgChunksAdded.toFixed(1)} chunks / ${results[bestIdx].avgPathsExplored.toFixed(0)} paths)`,
  );
}

async function main() {
  console.log('='.repeat(100));
  console.log('MIN WEIGHT THRESHOLD SWEEP');
  console.log('Testing: ' + MIN_WEIGHTS.join(', '));
  console.log('Queries: ' + TEST_QUERIES.length);
  console.log('Max depth: ' + MAX_DEPTH);
  console.log('='.repeat(100));

  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));

  const results = await runSweep(embedder);
  printResults(results);

  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
