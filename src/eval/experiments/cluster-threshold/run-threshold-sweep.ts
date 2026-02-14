/**
 * Phase 0.1: Cluster Assignment Threshold Sweep
 *
 * Find optimal angular distance threshold for assigning chunks to clusters.
 *
 * Method:
 * 1. Load embedding benchmark corpus
 * 2. Run HDBSCAN to get cluster assignments
 * 3. Compute pairwise angular distances within same-cluster vs cross-cluster
 * 4. Sweep threshold: 0.2, 0.3, 0.4, 0.5, 0.6
 * 5. Measure precision/recall of cluster membership prediction
 */

import { readFile } from 'fs/promises';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { clusterEmbeddings, getClusterMembership } from '../../cluster-evaluator.js';
import { angularDistance } from '../../../utils/angular-distance.js';
import type { Chunk } from '../../../parser/types.js';

/**
 * Result for a single threshold value.
 */
export interface ThresholdResult {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
}

/**
 * Complete sweep results.
 */
export interface ThresholdSweepResult {
  generatedAt: string;
  corpusSize: number;
  numClusters: number;
  noiseRatio: number;
  silhouetteScore: number;
  thresholds: ThresholdResult[];
  recommendedThreshold: number;
  withinClusterDistances: DistanceStats;
  crossClusterDistances: DistanceStats;
}

interface DistanceStats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Run the cluster threshold sweep experiment.
 */
export async function runThresholdSweep(
  corpusPath: string,
  options: {
    thresholds?: number[];
    minClusterSize?: number;
    embeddingModel?: string;
    verbose?: boolean;
  } = {},
): Promise<ThresholdSweepResult> {
  const {
    thresholds = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6],
    minClusterSize = 4,
    embeddingModel = 'jina-small',
    verbose = true,
  } = options;

  if (verbose) {
    console.log('\n=== Cluster Threshold Sweep Experiment ===\n');
    console.log(`Loading corpus from ${corpusPath}...`);
  }

  // Load corpus
  const corpusJson = await readFile(corpusPath, 'utf-8');
  const parsed = JSON.parse(corpusJson);
  // Handle both { chunks: [...] } and plain array formats
  const chunks: Chunk[] = Array.isArray(parsed) ? parsed : parsed.chunks;

  if (verbose) {
    console.log(`Loaded ${chunks.length} chunks`);
    console.log(`\nEmbedding with ${embeddingModel}...`);
  }

  // Embed all chunks
  const embedder = new Embedder();
  await embedder.load(getModel(embeddingModel));

  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (verbose && i % 50 === 0) {
      process.stdout.write(`\r  Embedding: ${i}/${chunks.length}`);
    }
    const result = await embedder.embed(chunks[i].text, false);
    embeddings.push(result.embedding);
  }

  await embedder.dispose();

  if (verbose) {
    console.log(`\r  Embedding: ${chunks.length}/${chunks.length} complete`);
    console.log(`\nRunning HDBSCAN (minClusterSize=${minClusterSize})...`);
  }

  // Run HDBSCAN
  const clusterResult = clusterEmbeddings(embeddings, { minClusterSize });
  const membership = getClusterMembership(clusterResult.labels);

  if (verbose) {
    console.log(`  Clusters found: ${clusterResult.numClusters}`);
    console.log(`  Noise ratio: ${(clusterResult.noiseRatio * 100).toFixed(1)}%`);
  }

  // Compute pairwise distances
  if (verbose) {
    console.log(`\nComputing pairwise distances...`);
  }

  const withinClusterDists: number[] = [];
  const crossClusterDists: number[] = [];

  // Build cluster assignments (excluding noise)
  const clusterAssignments = new Map<number, number>(); // chunkIndex -> clusterId
  for (const [clusterId, indices] of membership) {
    if (clusterId < 0) continue; // Skip noise
    for (const idx of indices) {
      clusterAssignments.set(idx, clusterId);
    }
  }

  // Sample pairs to avoid O(n²) explosion
  const MAX_PAIRS = 50000;
  const assignedIndices = [...clusterAssignments.keys()];

  // Within-cluster pairs
  for (const [clusterId, indices] of membership) {
    if (clusterId < 0) continue;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const dist = angularDistance(embeddings[indices[i]], embeddings[indices[j]]);
        withinClusterDists.push(dist);
        if (withinClusterDists.length >= MAX_PAIRS) break;
      }
      if (withinClusterDists.length >= MAX_PAIRS) break;
    }
    if (withinClusterDists.length >= MAX_PAIRS) break;
  }

  // Cross-cluster pairs (sample)
  const numCrossSamples = Math.min(MAX_PAIRS, assignedIndices.length * 10);
  for (let s = 0; s < numCrossSamples; s++) {
    const i = assignedIndices[Math.floor(Math.random() * assignedIndices.length)];
    const j = assignedIndices[Math.floor(Math.random() * assignedIndices.length)];
    if (i === j) continue;
    if (clusterAssignments.get(i) === clusterAssignments.get(j)) continue;

    const dist = angularDistance(embeddings[i], embeddings[j]);
    crossClusterDists.push(dist);
  }

  if (verbose) {
    console.log(`  Within-cluster pairs: ${withinClusterDists.length}`);
    console.log(`  Cross-cluster pairs: ${crossClusterDists.length}`);
  }

  // Compute distance statistics
  const withinStats = computeStats(withinClusterDists);
  const crossStats = computeStats(crossClusterDists);

  if (verbose) {
    console.log(
      `\n  Within-cluster distance: mean=${withinStats.mean.toFixed(3)}, median=${withinStats.median.toFixed(3)}`,
    );
    console.log(
      `  Cross-cluster distance: mean=${crossStats.mean.toFixed(3)}, median=${crossStats.median.toFixed(3)}`,
    );
  }

  // Compute silhouette score (simplified)
  const silhouette = computeSimplifiedSilhouette(embeddings, clusterResult.labels);

  if (verbose) {
    console.log(`  Silhouette score: ${silhouette.toFixed(3)}`);
  }

  // Sweep thresholds
  if (verbose) {
    console.log(`\n--- Threshold Sweep ---`);
    console.log('Threshold | Precision | Recall | F1     | TP     | FP     | FN');
    console.log('-'.repeat(70));
  }

  const thresholdResults: ThresholdResult[] = [];

  for (const threshold of thresholds) {
    // For each pair, predict "same cluster" if distance < threshold
    // True positive: predicted same, actually same
    // False positive: predicted same, actually different
    // False negative: predicted different, actually same
    // True negative: predicted different, actually different

    let tp = 0,
      fp = 0,
      fn = 0,
      tn = 0;

    // Within-cluster (should predict same)
    for (const dist of withinClusterDists) {
      if (dist < threshold) {
        tp++;
      } else {
        fn++;
      }
    }

    // Cross-cluster (should predict different)
    for (const dist of crossClusterDists) {
      if (dist < threshold) {
        fp++;
      } else {
        tn++;
      }
    }

    const precision = tp > 0 ? tp / (tp + fp) : 0;
    const recall = tp > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    thresholdResults.push({
      threshold,
      precision,
      recall,
      f1,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
    });

    if (verbose) {
      console.log(
        `${threshold.toFixed(2).padEnd(9)} | ${precision.toFixed(3).padEnd(9)} | ${recall.toFixed(3).padEnd(6)} | ${f1.toFixed(3).padEnd(6)} | ${tp.toString().padEnd(6)} | ${fp.toString().padEnd(6)} | ${fn}`,
      );
    }
  }

  // Find optimal threshold (highest F1)
  const best = thresholdResults.reduce((a, b) => (a.f1 > b.f1 ? a : b));

  if (verbose) {
    console.log('-'.repeat(70));
    console.log(`\nRecommended threshold: ${best.threshold} (F1=${best.f1.toFixed(3)})`);
  }

  return {
    generatedAt: new Date().toISOString(),
    corpusSize: chunks.length,
    numClusters: clusterResult.numClusters,
    noiseRatio: clusterResult.noiseRatio,
    silhouetteScore: silhouette,
    thresholds: thresholdResults,
    recommendedThreshold: best.threshold,
    withinClusterDistances: withinStats,
    crossClusterDistances: crossStats,
  };
}

/**
 * Compute basic statistics for an array of numbers.
 */
function computeStats(values: number[]): DistanceStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, std: 0, min: 0, max: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);

  return {
    mean,
    median,
    std,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: values.length,
  };
}

/**
 * Compute simplified silhouette score.
 */
function computeSimplifiedSilhouette(embeddings: number[][], labels: number[]): number {
  const clusteredIndices = labels
    .map((l, i) => ({ label: l, index: i }))
    .filter((x) => x.label >= 0);

  if (clusteredIndices.length < 2) return 0;

  let totalSilhouette = 0;
  const sampleSize = Math.min(500, clusteredIndices.length);

  // Sample points for efficiency
  const sampled = clusteredIndices.sort(() => Math.random() - 0.5).slice(0, sampleSize);

  for (const { label, index } of sampled) {
    // a(i) = mean distance to same cluster
    const sameCluster = clusteredIndices.filter((x) => x.label === label && x.index !== index);
    if (sameCluster.length === 0) continue;

    const a =
      sameCluster.reduce(
        (sum, x) => sum + angularDistance(embeddings[index], embeddings[x.index]),
        0,
      ) / sameCluster.length;

    // b(i) = min mean distance to other clusters
    const otherLabels = [...new Set(clusteredIndices.map((x) => x.label))].filter(
      (l) => l !== label,
    );
    if (otherLabels.length === 0) continue;

    let b = Infinity;
    for (const otherLabel of otherLabels) {
      const otherCluster = clusteredIndices.filter((x) => x.label === otherLabel);
      const meanDist =
        otherCluster.reduce(
          (sum, x) => sum + angularDistance(embeddings[index], embeddings[x.index]),
          0,
        ) / otherCluster.length;
      b = Math.min(b, meanDist);
    }

    const s = (b - a) / Math.max(a, b);
    totalSilhouette += s;
  }

  return totalSilhouette / sampled.length;
}
