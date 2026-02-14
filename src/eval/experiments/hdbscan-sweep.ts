/**
 * Experiment 2: HDBSCAN minClusterSize Sweep
 *
 * Question: Is minClusterSize=3 optimal, or are we leaving structure on the table?
 *
 * Reuses jina-small embeddings and sweeps minClusterSize from 2 to 10,
 * recording cluster count, noise ratio, and silhouette score for each.
 */

import { clusterEmbeddings } from '../cluster-evaluator.js';
import { silhouetteScore } from '../metrics.js';
import type { Chunk } from '../../parser/types.js';
import type { LabeledPair } from '../annotation-schema.js';
import { singleModelRun, type SingleModelResult } from './single-model-run.js';
import type { SweepResult, SweepRow } from './types.js';

const MODEL_ID = 'jina-small';
const MIN_CLUSTER_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Run the HDBSCAN parameter sweep.
 *
 * If baselineResult is provided (with embeddings), reuses them to avoid re-embedding.
 */
export async function runHdbscanSweep(
  chunks: Chunk[],
  pairs: LabeledPair[],
  baselineResult?: SingleModelResult,
): Promise<SweepResult> {
  console.log('\n=== Experiment 2: HDBSCAN minClusterSize Sweep ===');

  // Get embeddings (reuse or compute)
  let embeddingsMap: Map<string, number[]>;
  if (baselineResult) {
    console.log('  Reusing cached embeddings');
    embeddingsMap = baselineResult.embeddings;
  } else {
    console.log('  Computing embeddings...');
    const result = await singleModelRun(MODEL_ID, chunks, pairs);
    embeddingsMap = result.embeddings;
  }

  // Build ordered embedding array
  const embeddingArray = chunks.map((c) => embeddingsMap.get(c.id)!).filter(Boolean);

  // Sweep
  const rows: SweepRow[] = [];

  console.log('');
  console.log(
    '  ' + pad('minSize', 8) + pad('Clusters', 10) + pad('Noise%', 10) + pad('Silhouette', 12),
  );
  console.log('  ' + '-'.repeat(40));

  for (const minClusterSize of MIN_CLUSTER_SIZES) {
    const clusterResult = clusterEmbeddings(embeddingArray, { minClusterSize });
    const silhouette = silhouetteScore(embeddingArray, clusterResult.labels);

    const row: SweepRow = {
      minClusterSize,
      clusterCount: clusterResult.numClusters,
      noiseRatio: clusterResult.noiseRatio,
      silhouetteScore: silhouette,
    };
    rows.push(row);

    console.log(
      '  ' +
        pad(String(minClusterSize), 8) +
        pad(String(clusterResult.numClusters), 10) +
        pad((clusterResult.noiseRatio * 100).toFixed(1) + '%', 10) +
        pad(silhouette.toFixed(3), 12),
    );
  }

  // Find optimal
  const best = rows.reduce((a, b) => (b.silhouetteScore > a.silhouetteScore ? b : a));
  console.log(
    `\n  Best silhouette: minClusterSize=${best.minClusterSize} (silhouette=${best.silhouetteScore.toFixed(3)})`,
  );

  return {
    name: 'hdbscan-sweep',
    description: `HDBSCAN minClusterSize sweep from ${MIN_CLUSTER_SIZES[0]} to ${MIN_CLUSTER_SIZES[MIN_CLUSTER_SIZES.length - 1]}. Best silhouette at minClusterSize=${best.minClusterSize}.`,
    rows,
  };
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}
