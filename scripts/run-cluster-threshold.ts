/**
 * Phase 0.1: Run cluster assignment threshold sweep.
 *
 * Usage: npm run cluster-threshold -- [options]
 */

import { writeFile } from 'fs/promises';
import { runThresholdSweep } from '../src/eval/experiments/cluster-threshold/run-threshold-sweep.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let corpusPath = 'test/fixtures/corpus/corpus.json';
  let outputPath = 'benchmark-results/cluster-threshold-sweep.json';
  let minClusterSize = 4;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) {
      corpusPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--min-cluster-size' && args[i + 1]) {
      minClusterSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Phase 0.1: Cluster Assignment Threshold Sweep

Find optimal angular distance threshold for assigning chunks to clusters.

Usage: npm run cluster-threshold -- [options]

Options:
  --corpus <path>          Path to corpus JSON file (default: test/fixtures/corpus/corpus.json)
  --output <path>          Output JSON file (default: benchmark-results/cluster-threshold-sweep.json)
  --min-cluster-size <n>   HDBSCAN min cluster size (default: 4)
  --help                   Show this help message

Example:
  npm run cluster-threshold -- --min-cluster-size 5
      `);
      process.exit(0);
    }
  }

  const result = await runThresholdSweep(corpusPath, {
    minClusterSize,
    verbose: true,
  });

  // Write results
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nResults written to ${outputPath}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Corpus size: ${result.corpusSize} chunks`);
  console.log(`Clusters: ${result.numClusters}`);
  console.log(`Noise ratio: ${(result.noiseRatio * 100).toFixed(1)}%`);
  console.log(`Silhouette: ${result.silhouetteScore.toFixed(3)}`);
  console.log(`\nWithin-cluster distance: ${result.withinClusterDistances.mean.toFixed(3)} ± ${result.withinClusterDistances.std.toFixed(3)}`);
  console.log(`Cross-cluster distance: ${result.crossClusterDistances.mean.toFixed(3)} ± ${result.crossClusterDistances.std.toFixed(3)}`);
  console.log(`\n*** Recommended threshold: ${result.recommendedThreshold} ***`);

  // Find best by precision if different
  const bestPrecision = result.thresholds.reduce((a, b) => a.precision > b.precision ? a : b);
  const bestRecall = result.thresholds.reduce((a, b) => a.recall > b.recall ? a : b);

  if (bestPrecision.threshold !== result.recommendedThreshold) {
    console.log(`    (Best precision: ${bestPrecision.threshold} with ${(bestPrecision.precision * 100).toFixed(1)}%)`);
  }
  if (bestRecall.threshold !== result.recommendedThreshold && bestRecall.threshold !== bestPrecision.threshold) {
    console.log(`    (Best recall: ${bestRecall.threshold} with ${(bestRecall.recall * 100).toFixed(1)}%)`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
