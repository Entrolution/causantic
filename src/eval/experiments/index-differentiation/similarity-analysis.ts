/**
 * Phase 1: Intra-cluster similarity analysis.
 *
 * For each cluster with 3+ index entries, compute:
 * - Mean pairwise cosine similarity between index entry embeddings
 * - Mean pairwise cosine similarity between raw chunk embeddings
 * - Compression ratio (entry_sim / chunk_sim)
 *
 * If ratio > 1, the LLM compression homogenized the entries (bad for discrimination).
 * If ratio < 1, the LLM naturally differentiates entries (good).
 */

import { cosineSimilarity } from '../../../utils/angular-distance.js';
import type { ClusterSimilarityResult } from './types.js';

/** Input: a cluster ready for analysis, with matched embeddings. */
export interface ClusterForAnalysis {
  clusterId: string;
  clusterName: string | null;
  entries: Array<{
    entryId: string;
    entryEmbedding: number[];
    chunkEmbeddings: number[][];
  }>;
}

/**
 * Compute pairwise cosine similarity statistics for a set of vectors.
 * Returns mean and standard deviation.
 */
function pairwiseStats(vectors: number[][]): { mean: number; stdDev: number } {
  if (vectors.length < 2) return { mean: 1.0, stdDev: 0 };

  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sims.push(cosineSimilarity(vectors[i], vectors[j]));
    }
  }

  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const variance = sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Analyse similarity for a single cluster.
 */
export function analyseCluster(cluster: ClusterForAnalysis): ClusterSimilarityResult {
  const entryEmbeddings = cluster.entries.map((e) => e.entryEmbedding);
  const entryStats = pairwiseStats(entryEmbeddings);

  // For chunk comparison, take the first chunk embedding per entry
  // (entries are 1:1 with chunks currently)
  const chunkEmbeddings = cluster.entries
    .flatMap((e) => e.chunkEmbeddings)
    .filter((e) => e.length > 0);
  const chunkStats = pairwiseStats(chunkEmbeddings);

  const compressionRatio =
    chunkStats.mean > 0 ? entryStats.mean / chunkStats.mean : 1.0;

  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    entryCount: cluster.entries.length,
    chunkCount: chunkEmbeddings.length,
    meanEntryPairSim: entryStats.mean,
    meanChunkPairSim: chunkStats.mean,
    compressionRatio,
    entrySimStdDev: entryStats.stdDev,
  };
}

/**
 * Run similarity analysis across all eligible clusters.
 */
export function runSimilarityAnalysis(
  clusters: ClusterForAnalysis[],
): ClusterSimilarityResult[] {
  return clusters.map(analyseCluster);
}
