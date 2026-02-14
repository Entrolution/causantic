/**
 * Console table + JSON output for benchmark results.
 */

import { writeFile } from 'node:fs/promises';
import type { BenchmarkResult, ModelBenchmarkResult } from '../core/benchmark-types.js';
import type { Chunk } from '../parser/types.js';

/**
 * Print a comparison table to the console.
 */
export function printComparisonTable(result: BenchmarkResult): void {
  console.log('\n' + '='.repeat(100));
  console.log('  EMBEDDING MODEL BENCHMARK RESULTS');
  console.log('='.repeat(100));
  console.log(
    `  Corpus: ${result.corpus.chunkCount} chunks, ${result.corpus.pairCount} labeled pairs`,
  );
  console.log('='.repeat(100));

  // Header
  const cols = [
    pad('Model', 14),
    pad('Dims', 5),
    pad('Context', 8),
    pad('ROC AUC', 8),
    pad('Clusters', 9),
    pad('Noise%', 7),
    pad('Silh.', 7),
    pad('CodeNL', 7),
    pad('ms/chunk', 9),
    pad('Load(s)', 8),
    pad('Heap(MB)', 9),
  ];
  console.log(cols.join(' | '));
  console.log('-'.repeat(100));

  // Rows
  for (const m of result.models) {
    const row = [
      pad(m.modelId, 14),
      pad(String(m.modelConfig.dims), 5),
      pad(String(m.modelConfig.contextTokens), 8),
      pad(m.rocAuc.toFixed(3), 8),
      pad(String(m.clusterCount), 9),
      pad((m.noiseRatio * 100).toFixed(1) + '%', 7),
      pad(m.silhouetteScore.toFixed(3), 7),
      pad(m.codeNLAlignment.alignmentRatio.toFixed(3), 7),
      pad(m.meanInferenceMs.toFixed(1), 9),
      pad((m.loadStats.loadTimeMs / 1000).toFixed(1), 8),
      pad(m.loadStats.heapUsedMB.toFixed(0), 9),
    ];
    console.log(row.join(' | '));
  }

  console.log('='.repeat(100));

  // Context window comparison
  if (result.contextWindowComparison) {
    const cw = result.contextWindowComparison;
    console.log('\nContext Window Impact:');
    console.log(`  Long chunks (>512 tokens): ${cw.longChunks} / ${cw.totalChunks}`);
    console.log(`  Mean drift (long chunks):  ${cw.meanDriftLongChunks.toFixed(4)}`);
    console.log(`  Mean drift (short chunks): ${cw.meanDriftShortChunks.toFixed(4)}`);
    if (cw.longChunkDrifts.length > 0) {
      console.log('  Top 5 drifting chunks:');
      for (const d of cw.longChunkDrifts.slice(0, 5)) {
        console.log(`    ${d.chunkId}: ${d.tokens} tokens, drift=${d.drift.toFixed(4)}`);
      }
    }
  }

  // Per-model cluster details
  console.log('\nCluster Details:');
  for (const m of result.models) {
    console.log(
      `  ${m.modelId}: ${m.clusterResult.clusterSizes.join(', ')} (${m.clusterResult.numClusters} clusters)`,
    );
  }

  console.log('');
}

/**
 * Print cluster membership with chunk text previews.
 */
export function printClusterMembership(
  modelResult: ModelBenchmarkResult,
  chunks: Chunk[],
  maxPreviewChars: number = 80,
): void {
  console.log(`\n--- Cluster membership for ${modelResult.modelId} ---`);

  for (const [label, indices] of modelResult.clusterMembership) {
    const labelStr = label < 0 ? 'NOISE' : `Cluster ${label}`;
    console.log(`\n  ${labelStr} (${indices.length} chunks):`);
    for (const idx of indices.slice(0, 10)) {
      const chunk = chunks[idx];
      const preview = chunk.text.replace(/\n/g, ' ').slice(0, maxPreviewChars);
      console.log(`    [${chunk.metadata.sessionSlug}] ${preview}...`);
    }
    if (indices.length > 10) {
      console.log(`    ... and ${indices.length - 10} more`);
    }
  }
}

/**
 * Write benchmark results as JSON.
 */
export async function writeJsonReport(result: BenchmarkResult, outputPath: string): Promise<void> {
  // Strip non-serializable data (embeddings, Maps)
  const serializable = {
    ...result,
    models: result.models.map((m) => ({
      modelId: m.modelId,
      modelConfig: m.modelConfig,
      loadStats: m.loadStats,
      rocAuc: m.rocAuc,
      clusterCount: m.clusterCount,
      noiseRatio: m.noiseRatio,
      silhouetteScore: m.silhouetteScore,
      codeNLAlignment: m.codeNLAlignment,
      meanInferenceMs: m.meanInferenceMs,
      totalInferenceMs: m.totalInferenceMs,
      clusterResult: {
        numClusters: m.clusterResult.numClusters,
        noiseRatio: m.clusterResult.noiseRatio,
        clusterSizes: m.clusterResult.clusterSizes,
      },
      clusterMembership: Object.fromEntries(m.clusterMembership),
    })),
  };

  await writeFile(outputPath, JSON.stringify(serializable, null, 2));
  console.log(`Report written to ${outputPath}`);
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}
