/**
 * Core distance computation for HDBSCAN.
 * Core distance = distance to k-th nearest neighbor.
 */

import { KDTree, euclideanDistance, angularDistance } from './kd-tree.js';

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
 * Quickselect algorithm to find k-th smallest element.
 * Average O(n), worst case O(n^2).
 */
function quickselect(arr: number[], k: number): number {
  if (arr.length === 0) {
    return 0;
  }

  if (k >= arr.length) {
    k = arr.length - 1;
  }

  // Make a copy to avoid modifying the original
  const copy = arr.slice();
  return quickselectInPlace(copy, 0, copy.length - 1, k);
}

function quickselectInPlace(arr: number[], left: number, right: number, k: number): number {
  if (left === right) {
    return arr[left];
  }

  // Choose pivot using median of three
  const mid = Math.floor((left + right) / 2);
  if (arr[mid] < arr[left]) swap(arr, left, mid);
  if (arr[right] < arr[left]) swap(arr, left, right);
  if (arr[right] < arr[mid]) swap(arr, mid, right);

  const pivotIndex = partition(arr, left, right, mid);

  if (k === pivotIndex) {
    return arr[k];
  } else if (k < pivotIndex) {
    return quickselectInPlace(arr, left, pivotIndex - 1, k);
  } else {
    return quickselectInPlace(arr, pivotIndex + 1, right, k);
  }
}

function partition(arr: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = arr[pivotIndex];
  swap(arr, pivotIndex, right);
  let storeIndex = left;

  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      swap(arr, i, storeIndex);
      storeIndex++;
    }
  }

  swap(arr, storeIndex, right);
  return storeIndex;
}

function swap(arr: number[], i: number, j: number): void {
  const temp = arr[i];
  arr[i] = arr[j];
  arr[j] = temp;
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
