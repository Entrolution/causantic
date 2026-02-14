/**
 * HDBSCAN clustering wrapper + cluster quality evaluation.
 *
 * hdbscan-ts uses Euclidean distance internally. For normalized embeddings,
 * Euclidean distance is monotonically related to angular distance:
 *   ||a - b||^2 = 2(1 - cos(a,b))
 * So HDBSCAN clusters on normalized vectors produce equivalent groupings
 * to clustering on angular distance.
 */

import { HDBSCAN } from '../clusters/hdbscan.js';

export interface ClusterResult {
  /** Cluster label per point (-1 = noise). */
  labels: number[];
  /** Number of clusters found (excluding noise). */
  numClusters: number;
  /** Proportion of points labeled as noise. */
  noiseRatio: number;
  /** Cluster sizes (excluding noise). */
  clusterSizes: number[];
}

export interface ClusterOptions {
  /** Minimum cluster size. Default: 3. */
  minClusterSize?: number;
  /** Minimum samples. Default: same as minClusterSize. */
  minSamples?: number;
}

/**
 * Run HDBSCAN clustering on normalized embeddings.
 *
 * Embeddings should be L2-normalized (as produced by the embedder).
 * HDBSCAN uses Euclidean distance, which on normalized vectors is
 * monotonically related to angular distance.
 */
export function clusterEmbeddings(
  embeddings: number[][],
  options: ClusterOptions = {},
): ClusterResult {
  const { minClusterSize = 3, minSamples } = options;

  const hdbscan = new HDBSCAN({
    minClusterSize,
    minSamples: minSamples ?? minClusterSize,
  });

  const labels = hdbscan.fitSync(embeddings);

  // Compute stats
  const uniqueClusters = new Set(labels.filter((l: number) => l >= 0));
  const numClusters = uniqueClusters.size;
  const noiseCount = labels.filter((l: number) => l < 0).length;
  const noiseRatio = labels.length > 0 ? noiseCount / labels.length : 0;

  const clusterSizes: number[] = [];
  for (const c of uniqueClusters) {
    clusterSizes.push(labels.filter((l: number) => l === c).length);
  }
  clusterSizes.sort((a, b) => b - a);

  return { labels, numClusters, noiseRatio, clusterSizes };
}

/**
 * Get cluster membership for inspection.
 * Returns a map from cluster label to list of point indices.
 */
export function getClusterMembership(labels: number[]): Map<number, number[]> {
  const membership = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!membership.has(label)) membership.set(label, []);
    membership.get(label)!.push(i);
  }
  return membership;
}
