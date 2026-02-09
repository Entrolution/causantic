/**
 * Sweep maxDepth to find optimal value with new sum-product traversal.
 *
 * Tests different maxDepth values and measures:
 * - Augmentation: additional chunks found via graph traversal
 * - Paths explored: computational cost
 * - Weight distribution: quality of results
 */

import { vectorStore } from '../src/storage/vector-store.js';
import { traverseMultiple } from '../src/retrieval/traverser.js';
import { getReferenceClock } from '../src/storage/clock-store.js';
import { getChunkById } from '../src/storage/chunk-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { getDb, closeDb } from '../src/storage/db.js';

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

const DEPTHS = [3, 5, 7, 10, 15, 20, 25, 30];
const MIN_WEIGHT = 0.01;

interface DepthResult {
  depth: number;
  avgChunksAdded: number;
  avgPathsExplored: number;
  avgMaxWeight: number;
  avgMedianWeight: number;
  avgMinWeight: number;
  totalTimeMs: number;
}

async function runSweep(embedder: Embedder): Promise<DepthResult[]> {
  const results: DepthResult[] = [];

  for (const depth of DEPTHS) {
    console.log(`\nTesting maxDepth = ${depth}...`);

    let totalChunksAdded = 0;
    let totalPathsExplored = 0;
    let totalMaxWeight = 0;
    let totalMedianWeight = 0;
    let totalMinWeight = 0;
    const startTime = Date.now();

    for (const query of TEST_QUERIES) {
      process.stdout.write('  ' + query.slice(0, 30).padEnd(32) + '... ');

      // Get vector search results
      const { embedding } = await embedder.embed(query, true);
      const vectorResults = await vectorStore.search(embedding, 10);
      const vectorChunkIds = new Set(vectorResults.map(r => r.id));

      // Get reference clock
      const firstChunk = getChunkById(vectorResults[0]?.id);
      const projectSlug = firstChunk?.sessionSlug || '';
      const referenceClock = getReferenceClock(projectSlug);

      const startIds = vectorResults.map(r => r.id);
      const startWeights = vectorResults.map(r => Math.max(0, 1 - r.distance));

      // Traverse backward
      const backwardResult = await traverseMultiple(startIds, startWeights, Date.now(), {
        direction: 'backward',
        referenceClock,
        maxDepth: depth,
        minWeight: MIN_WEIGHT,
      });

      // Traverse forward
      const forwardResult = await traverseMultiple(startIds, startWeights, Date.now(), {
        direction: 'forward',
        referenceClock,
        maxDepth: depth,
        minWeight: MIN_WEIGHT,
      });

      // Combine and dedupe
      const allChunks = [...backwardResult.chunks, ...forwardResult.chunks];
      const newChunks = allChunks.filter(c => !vectorChunkIds.has(c.chunkId));
      const weights = newChunks.map(c => c.weight).sort((a, b) => b - a);

      totalChunksAdded += newChunks.length;
      totalPathsExplored += backwardResult.visited + forwardResult.visited;

      if (weights.length > 0) {
        totalMaxWeight += weights[0];
        totalMedianWeight += weights[Math.floor(weights.length / 2)];
        totalMinWeight += weights[weights.length - 1];
      }

      console.log(`+${newChunks.length} chunks, ${backwardResult.visited + forwardResult.visited} paths`);
    }

    const elapsed = Date.now() - startTime;
    const n = TEST_QUERIES.length;

    results.push({
      depth,
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

function printResults(results: DepthResult[]) {
  console.log('\n' + '='.repeat(110));
  console.log('MAX DEPTH SWEEP RESULTS (minWeight=' + MIN_WEIGHT + ')');
  console.log('='.repeat(110));

  console.log('\nmaxDepth | Chunks Added | Paths Explored | Augmentation | Max Weight | Median Weight | Time (ms)');
  console.log('-'.repeat(110));

  const baselineChunks = 10; // vector search returns 10 seeds

  for (const r of results) {
    const augmentation = ((r.avgChunksAdded + baselineChunks) / baselineChunks).toFixed(2) + 'x';
    console.log(
      String(r.depth).padStart(8) + ' | ' +
      r.avgChunksAdded.toFixed(1).padStart(12) + ' | ' +
      r.avgPathsExplored.toFixed(0).padStart(14) + ' | ' +
      augmentation.padStart(12) + ' | ' +
      r.avgMaxWeight.toFixed(4).padStart(10) + ' | ' +
      r.avgMedianWeight.toFixed(4).padStart(13) + ' | ' +
      String(r.totalTimeMs).padStart(9)
    );
  }

  console.log('\n' + '='.repeat(110));
  console.log('ANALYSIS');
  console.log('='.repeat(110));

  // Diminishing returns
  console.log('\nDiminishing returns (chunks added per depth increase):');
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    const chunkGain = curr.avgChunksAdded - prev.avgChunksAdded;
    const depthGain = curr.depth - prev.depth;
    const chunksPerDepth = chunkGain / depthGain;
    const pathGain = curr.avgPathsExplored - prev.avgPathsExplored;

    console.log(
      `  depth ${prev.depth} → ${curr.depth}: ` +
      `+${chunkGain.toFixed(1)} chunks (+${(chunkGain / prev.avgChunksAdded * 100).toFixed(1)}%), ` +
      `+${pathGain.toFixed(0)} paths, ` +
      `${chunksPerDepth.toFixed(2)} chunks/depth`
    );
  }

  // Find optimal depth (best chunks/paths ratio)
  console.log('\nEfficiency (chunks added / paths explored):');
  let bestDepth = results[0].depth;
  let bestEfficiency = 0;
  for (const r of results) {
    const efficiency = r.avgChunksAdded / r.avgPathsExplored;
    const marker = efficiency > bestEfficiency ? ' ← best' : '';
    if (efficiency > bestEfficiency) {
      bestEfficiency = efficiency;
      bestDepth = r.depth;
    }
    console.log(`  depth=${r.depth}: ${efficiency.toFixed(3)}${marker}`);
  }

  // Recommendation
  console.log('\n' + '='.repeat(110));
  console.log('RECOMMENDATION');
  console.log('='.repeat(110));

  // Find depth where gains become marginal (<5% per depth unit)
  let recommendedDepth = results[results.length - 1].depth;
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    const percentGain = (curr.avgChunksAdded - prev.avgChunksAdded) / prev.avgChunksAdded * 100;
    const gainPerDepth = percentGain / (curr.depth - prev.depth);

    if (gainPerDepth < 1.0) {  // Less than 1% gain per depth unit
      recommendedDepth = prev.depth;
      console.log(`\nDiminishing returns start at depth=${prev.depth} (${gainPerDepth.toFixed(2)}%/depth after)`);
      break;
    }
  }

  const finalResult = results.find(r => r.depth === recommendedDepth) || results[results.length - 1];
  console.log(`\nRecommended: maxDepth=${recommendedDepth}`);
  console.log(`  - Chunks added: ${finalResult.avgChunksAdded.toFixed(1)}`);
  console.log(`  - Augmentation: ${((finalResult.avgChunksAdded + 10) / 10).toFixed(2)}x`);
  console.log(`  - Paths explored: ${finalResult.avgPathsExplored.toFixed(0)}`);
  console.log(`  - Time: ${finalResult.totalTimeMs}ms`);
}

async function main() {
  console.log('='.repeat(110));
  console.log('MAX DEPTH SWEEP (Sum-Product Traversal)');
  console.log('Testing depths: ' + DEPTHS.join(', '));
  console.log('Fixed minWeight: ' + MIN_WEIGHT);
  console.log('Queries: ' + TEST_QUERIES.length);
  console.log('='.repeat(110));

  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));

  const results = await runSweep(embedder);
  printResults(results);

  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
