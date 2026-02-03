/**
 * Evaluation metrics for embedding quality.
 *
 * - ROC AUC from labeled pairs scored by angular distance
 * - Silhouette score for cluster quality
 */

import { angularDistance } from '../utils/angular-distance.js';
import type { LabeledPair } from './annotation-schema.js';

export interface ScoredPair {
  pair: LabeledPair;
  distance: number;
}

/**
 * Score all labeled pairs by angular distance between their embeddings.
 */
export function scorePairs(
  pairs: LabeledPair[],
  embeddings: Map<string, number[]>,
): ScoredPair[] {
  return pairs
    .filter(
      (p) => embeddings.has(p.chunkIdA) && embeddings.has(p.chunkIdB),
    )
    .map((pair) => ({
      pair,
      distance: angularDistance(
        embeddings.get(pair.chunkIdA)!,
        embeddings.get(pair.chunkIdB)!,
      ),
    }));
}

/**
 * Compute ROC AUC for binary classification.
 *
 * Positive class: 'related' or 'code-nl-pair' (should have low distance)
 * Negative class: 'unrelated' (should have high distance)
 *
 * We use distance as the score, so lower distance = more likely positive.
 * For AUC calculation we invert: score = 1 - distance.
 */
export function rocAuc(scoredPairs: ScoredPair[]): number {
  // Split into positive (related) and negative (unrelated)
  const positives: number[] = [];
  const negatives: number[] = [];

  for (const { pair, distance } of scoredPairs) {
    const score = 1 - distance; // Higher score = more related
    if (pair.label === 'unrelated') {
      negatives.push(score);
    } else {
      positives.push(score);
    }
  }

  if (positives.length === 0 || negatives.length === 0) return 0.5;

  // Wilcoxon-Mann-Whitney statistic
  let concordant = 0;
  let ties = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos > neg) concordant++;
      else if (pos === neg) ties++;
    }
  }

  return (concordant + 0.5 * ties) / (positives.length * negatives.length);
}

/**
 * Compute silhouette score for a clustering.
 *
 * For each point:
 *   a(i) = mean distance to other points in same cluster
 *   b(i) = min over clusters C != own: mean distance to points in C
 *   s(i) = (b(i) - a(i)) / max(a(i), b(i))
 *
 * Returns mean silhouette across all clustered points. Range [-1, 1].
 */
export function silhouetteScore(
  embeddings: number[][],
  labels: number[],
): number {
  const n = embeddings.length;
  if (n < 2) return 0;

  // Find unique clusters (exclude noise label -1)
  const clusters = [...new Set(labels.filter((l) => l >= 0))];
  if (clusters.length < 2) return 0;

  // Group indices by cluster
  const clusterMembers = new Map<number, number[]>();
  for (const c of clusters) {
    clusterMembers.set(
      c,
      labels.reduce<number[]>((acc, l, i) => {
        if (l === c) acc.push(i);
        return acc;
      }, []),
    );
  }

  let totalSilhouette = 0;
  let clusteredCount = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] < 0) continue; // Skip noise
    clusteredCount++;

    const ownCluster = labels[i];
    const ownMembers = clusterMembers.get(ownCluster)!;

    // a(i): mean distance to same-cluster points
    let ai = 0;
    if (ownMembers.length > 1) {
      for (const j of ownMembers) {
        if (j !== i) ai += angularDistance(embeddings[i], embeddings[j]);
      }
      ai /= ownMembers.length - 1;
    }

    // b(i): min mean distance to other clusters
    let bi = Infinity;
    for (const c of clusters) {
      if (c === ownCluster) continue;
      const members = clusterMembers.get(c)!;
      let meanDist = 0;
      for (const j of members) {
        meanDist += angularDistance(embeddings[i], embeddings[j]);
      }
      meanDist /= members.length;
      if (meanDist < bi) bi = meanDist;
    }

    const si =
      Math.max(ai, bi) === 0 ? 0 : (bi - ai) / Math.max(ai, bi);
    totalSilhouette += si;
  }

  return clusteredCount > 0 ? totalSilhouette / clusteredCount : 0;
}

/**
 * Compute the noise ratio (proportion of unclustered points).
 */
export function noiseRatio(labels: number[]): number {
  if (labels.length === 0) return 0;
  const noiseCount = labels.filter((l) => l < 0).length;
  return noiseCount / labels.length;
}

/**
 * Count the number of unique clusters (excluding noise).
 */
export function clusterCount(labels: number[]): number {
  return new Set(labels.filter((l) => l >= 0)).size;
}
