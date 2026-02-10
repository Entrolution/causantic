/**
 * Core distance computation for HDBSCAN.
 * Core distance = distance to k-th nearest neighbor.
 */

import { KDTree, euclideanDistance, angularDistance } from './kd-tree.js';
import { quickselect } from '../../utils/array-utils.js';

/**
 * Compute core distances for all points.
 * Core distance is the distance to the k-th nearest neighbor.
 *
 * @param points All points (embeddings).
 * @param k k value (typically minSamples).
 * @param metric Distance metric.
 * @param useKDTree Whether to use KD-tree for approximate k-NN.
 */
export function computeCoreDistances(
  points: number[][],
  k: number,
  metric: 'euclidean' | 'angular' = 'euclidean',
  useKDTree: boolean = false
): number[] {
  const n = points.length;

  if (n === 0) {
    return [];
  }

  // k must be at most n-1 (can't count self as neighbor)
  const effectiveK = Math.min(k, n - 1);

  if (effectiveK <= 0) {
    // Only 1 point, core distance is 0
    return new Array(n).fill(0);
  }

  if (useKDTree && metric === 'euclidean') {
    return computeCoreDistancesKDTree(points, effectiveK);
  }

  return computeCoreDistancesBruteForce(points, effectiveK, metric);
}

/**
 * Brute force core distance computation using quickselect.
 */
function computeCoreDistancesBruteForce(
  points: number[][],
  k: number,
  metric: 'euclidean' | 'angular'
): number[] {
  const n = points.length;
  const coreDistances = new Array<number>(n);
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;

  for (let i = 0; i < n; i++) {
    // Compute distances to all other points
    const distances: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        distances.push(distFn(points[i], points[j]));
      }
    }

    // Use quickselect to find k-th smallest distance
    coreDistances[i] = quickselect(distances, k - 1);
  }

  return coreDistances;
}

/**
 * KD-tree based core distance computation.
 */
function computeCoreDistancesKDTree(points: number[][], k: number): number[] {
  const tree = new KDTree(points);
  const coreDistances = new Array<number>(points.length);

  for (let i = 0; i < points.length; i++) {
    const neighbors = tree.kNearest(points[i], k, i);
    if (neighbors.length === k) {
      coreDistances[i] = neighbors[k - 1].distance;
    } else {
      // Fewer than k neighbors, use max distance
      coreDistances[i] = neighbors.length > 0 ? neighbors[neighbors.length - 1].distance : 0;
    }
  }

  return coreDistances;
}

/**
 * Compute core distances for a chunk of indices (for parallel processing).
 * @param indices Indices to process.
 * @param allPoints All points.
 * @param k k value.
 * @param metric Distance metric.
 */
export function computeCoreDistancesChunk(
  indices: number[],
  allPoints: number[][],
  k: number,
  metric: 'euclidean' | 'angular' = 'euclidean'
): Array<{ index: number; coreDistance: number }> {
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;
  const n = allPoints.length;
  const effectiveK = Math.min(k, n - 1);
  const results: Array<{ index: number; coreDistance: number }> = [];

  for (const i of indices) {
    const distances: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        distances.push(distFn(allPoints[i], allPoints[j]));
      }
    }

    const coreDistance = effectiveK > 0 ? quickselect(distances, effectiveK - 1) : 0;
    results.push({ index: i, coreDistance });
  }

  return results;
}
