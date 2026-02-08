/**
 * CLI script for running HDBSCAN clustering on all chunks.
 * Usage: npm run recluster
 */

import { clusterManager } from '../src/clusters/cluster-manager.js';
import { getDbStats, closeDb } from '../src/storage/db.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let minClusterSize = 4;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-size' && args[i + 1]) {
      minClusterSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run recluster -- [options]

Options:
  --min-size <n>    Minimum cluster size (default: 4)
  --help            Show this help message

Example:
  npm run recluster -- --min-size 5
      `);
      process.exit(0);
    }
  }

  // Get initial stats
  const beforeStats = getDbStats();
  console.log(`\nBefore clustering:`);
  console.log(`  Chunks:    ${beforeStats.chunks}`);
  console.log(`  Clusters:  ${beforeStats.clusters}`);

  console.log(`\nRunning HDBSCAN with minClusterSize=${minClusterSize}...`);

  const result = await clusterManager.recluster({
    minClusterSize,
    clearExisting: true,
  });

  console.log(`\n=== Clustering Complete ===`);
  console.log(`Clusters found:      ${result.numClusters}`);
  console.log(`Chunks assigned:     ${result.assignedChunks}`);
  console.log(`Noise chunks:        ${result.noiseChunks}`);
  console.log(`Noise ratio:         ${(result.noiseRatio * 100).toFixed(1)}%`);
  console.log(`Duration:            ${result.durationMs}ms`);

  if (result.clusterSizes.length > 0) {
    console.log(`\nCluster sizes (top 10):`);
    for (let i = 0; i < Math.min(10, result.clusterSizes.length); i++) {
      console.log(`  Cluster ${i + 1}: ${result.clusterSizes[i]} chunks`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
