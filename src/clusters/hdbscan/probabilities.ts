/**
 * Membership probabilities and outlier scores for HDBSCAN.
 */

import type { CondensedTree } from './types.js';

/**
 * Compute membership probabilities for each point.
 * Probability indicates how "core" a point is to its cluster.
 *
 * probability[i] = (lambda[i] - lambda_birth) / (lambda_max - lambda_birth)
 *
 * @param tree Condensed cluster tree.
 * @param labels Cluster labels for each point.
 * @param selectedClusters Selected cluster IDs.
 * @returns Probability for each point (0.0-1.0).
 */
export function computeProbabilities(
  tree: CondensedTree,
  labels: number[],
  selectedClusters: number[],
): number[] {
  const probabilities = new Array<number>(tree.numPoints).fill(0);

  // Compute max lambda for each cluster
  const clusterMaxLambda = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) continue;

    const pointNode = tree.nodes.get(i);
    if (!pointNode) continue;

    const lambda = pointNode.lambdaDeath;
    if (isFinite(lambda)) {
      const current = clusterMaxLambda.get(label) ?? 0;
      clusterMaxLambda.set(label, Math.max(current, lambda));
    }
  }

  // Compute probabilities
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) {
      probabilities[i] = 0;
      continue;
    }

    const pointNode = tree.nodes.get(i);
    if (!pointNode) {
      probabilities[i] = 0;
      continue;
    }

    const clusterId = selectedClusters[label];
    const clusterNode = tree.nodes.get(clusterId);
    if (!clusterNode) {
      probabilities[i] = 0;
      continue;
    }

    const lambdaBirth = clusterNode.lambdaBirth;
    const lambdaMax = clusterMaxLambda.get(label) ?? pointNode.lambdaDeath;
    const lambdaPoint = pointNode.lambdaDeath;

    if (lambdaMax === lambdaBirth || !isFinite(lambdaMax)) {
      probabilities[i] = 1;
    } else {
      const prob = (lambdaPoint - lambdaBirth) / (lambdaMax - lambdaBirth);
      probabilities[i] = Math.max(0, Math.min(1, prob));
    }
  }

  return probabilities;
}

/**
 * Compute outlier scores (GLOSH) for each point.
 * Higher scores indicate more outlier-ish points.
 *
 * outlierScore[i] = 1 - (lambda[i] / lambda_max_in_cluster)
 *
 * @param tree Condensed cluster tree.
 * @param labels Cluster labels for each point.
 * @param selectedClusters Selected cluster IDs.
 * @returns Outlier score for each point (0.0-1.0).
 */
export function computeOutlierScores(
  tree: CondensedTree,
  labels: number[],
  _selectedClusters: number[],
): number[] {
  const scores = new Array<number>(tree.numPoints).fill(1);

  // Compute max lambda for each cluster
  const clusterMaxLambda = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) continue;

    const pointNode = tree.nodes.get(i);
    if (!pointNode) continue;

    const lambda = pointNode.lambdaDeath;
    if (isFinite(lambda)) {
      const current = clusterMaxLambda.get(label) ?? 0;
      clusterMaxLambda.set(label, Math.max(current, lambda));
    }
  }

  // Compute outlier scores
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) {
      // Noise points have maximum outlier score
      scores[i] = 1;
      continue;
    }

    const pointNode = tree.nodes.get(i);
    if (!pointNode) {
      scores[i] = 1;
      continue;
    }

    const lambdaMax = clusterMaxLambda.get(label);
    const lambdaPoint = pointNode.lambdaDeath;

    if (!lambdaMax || lambdaMax === 0 || !isFinite(lambdaPoint)) {
      scores[i] = 0;
    } else {
      const score = 1 - lambdaPoint / lambdaMax;
      scores[i] = Math.max(0, Math.min(1, score));
    }
  }

  return scores;
}

/**
 * Get lambda values for all points.
 */
export function getLambdaValues(tree: CondensedTree): number[] {
  const lambdas = new Array<number>(tree.numPoints).fill(0);

  for (let i = 0; i < tree.numPoints; i++) {
    const node = tree.nodes.get(i);
    if (node && isFinite(node.lambdaDeath)) {
      lambdas[i] = node.lambdaDeath;
    }
  }

  return lambdas;
}

/**
 * Get maximum lambda for each cluster.
 */
export function getClusterMaxLambda(tree: CondensedTree, labels: number[]): Map<number, number> {
  const maxLambda = new Map<number, number>();

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) continue;

    const node = tree.nodes.get(i);
    if (!node) continue;

    const lambda = node.lambdaDeath;
    if (isFinite(lambda)) {
      const current = maxLambda.get(label) ?? 0;
      maxLambda.set(label, Math.max(current, lambda));
    }
  }

  return maxLambda;
}
