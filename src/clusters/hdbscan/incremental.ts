/**
 * Incremental point assignment for HDBSCAN.
 * Assigns new points to existing clusters without reclustering.
 */

import { euclideanDistance, angularDistance } from './kd-tree.js';
import type { HDBSCANModel } from './types.js';

/**
 * Assign new points to existing clusters.
 *
 * For each new point:
 * 1. Find its k nearest neighbors in the original dataset
 * 2. Compute its core distance
 * 3. Find mutual reachability to cluster centroids
 * 4. Assign to closest cluster within threshold, or -1 (noise)
 *
 * @param newPoints New points to assign.
 * @param model Fitted HDBSCAN model.
 * @param k k value for core distance (typically minSamples).
 * @param metric Distance metric.
 * @returns Labels for new points.
 */
export function predictLabels(
  newPoints: number[][],
  model: HDBSCANModel,
  k: number,
  metric: 'euclidean' | 'angular' = 'euclidean'
): number[] {
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;
  const labels = new Array<number>(newPoints.length).fill(-1);

  if (model.centroids.size === 0) {
    return labels;
  }

  for (let i = 0; i < newPoints.length; i++) {
    const point = newPoints[i];

    // Compute core distance for new point
    const coreDistance = computeNewPointCoreDistance(
      point,
      model.embeddings,
      k,
      distFn
    );

    // Find closest cluster
    let bestLabel = -1;
    let bestDistance = Infinity;

    for (const [clusterLabel, centroid] of model.centroids) {
      // Get exemplar points for this cluster
      const exemplarIndices = model.exemplars.get(clusterLabel) ?? [];

      // Compute mutual reachability to exemplars
      let minMRD = Infinity;
      for (const exIdx of exemplarIndices) {
        const exCoreDistance = model.coreDistances[exIdx];
        const rawDist = distFn(point, model.embeddings[exIdx]);
        const mrd = Math.max(coreDistance, exCoreDistance, rawDist);
        minMRD = Math.min(minMRD, mrd);
      }

      // Also check distance to centroid
      const centroidDist = distFn(point, centroid);

      // Use minimum of MRD to exemplars and raw distance to centroid
      const effectiveDistance = Math.min(minMRD, centroidDist);

      if (effectiveDistance < bestDistance) {
        bestDistance = effectiveDistance;
        bestLabel = clusterLabel;
      }
    }

    // Assign if within reasonable threshold
    // Use the cluster's max lambda as a threshold guide
    if (bestLabel !== -1) {
      const maxLambda = model.clusterMaxLambda.get(bestLabel);
      if (maxLambda && maxLambda > 0) {
        const threshold = 1 / maxLambda;
        if (bestDistance <= threshold * 2) {
          // Allow some slack for new points
          labels[i] = bestLabel;
        }
      } else {
        // No lambda info, use distance-based heuristic
        labels[i] = bestLabel;
      }
    }
  }

  return labels;
}

/**
 * Compute core distance for a new point.
 */
function computeNewPointCoreDistance(
  point: number[],
  existingPoints: number[][],
  k: number,
  distFn: (a: number[], b: number[]) => number
): number {
  if (existingPoints.length === 0) {
    return 0;
  }

  const effectiveK = Math.min(k, existingPoints.length);
  if (effectiveK <= 0) {
    return 0;
  }

  // Compute distances to all existing points
  const distances = existingPoints.map((p) => distFn(point, p));

  // Quickselect to find k-th smallest
  return quickselect(distances, effectiveK - 1);
}

/**
 * Quickselect algorithm.
 */
function quickselect(arr: number[], k: number): number {
  if (arr.length === 0) return 0;
  if (k >= arr.length) k = arr.length - 1;

  const copy = arr.slice();
  return quickselectInPlace(copy, 0, copy.length - 1, k);
}

function quickselectInPlace(arr: number[], left: number, right: number, k: number): number {
  if (left === right) return arr[left];

  const mid = Math.floor((left + right) / 2);
  if (arr[mid] < arr[left]) swap(arr, left, mid);
  if (arr[right] < arr[left]) swap(arr, left, right);
  if (arr[right] < arr[mid]) swap(arr, mid, right);

  const pivotIndex = partition(arr, left, right, mid);

  if (k === pivotIndex) return arr[k];
  if (k < pivotIndex) return quickselectInPlace(arr, left, pivotIndex - 1, k);
  return quickselectInPlace(arr, pivotIndex + 1, right, k);
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
 * Compute centroid from points.
 */
export function computeCentroid(points: number[][]): number[] {
  if (points.length === 0) {
    return [];
  }

  const dim = points[0].length;
  const sum = new Array(dim).fill(0);

  for (const p of points) {
    for (let i = 0; i < dim; i++) {
      sum[i] += p[i];
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    sum[i] /= points.length;
    norm += sum[i] * sum[i];
  }

  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      sum[i] /= norm;
    }
  }

  return sum;
}

/**
 * Select exemplar points (closest to centroid).
 */
export function selectExemplars(
  pointIndices: number[],
  points: number[][],
  centroid: number[],
  numExemplars: number = 3,
  metric: 'euclidean' | 'angular' = 'euclidean'
): number[] {
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;

  const withDistances = pointIndices.map((idx) => ({
    index: idx,
    distance: distFn(points[idx], centroid),
  }));

  withDistances.sort((a, b) => a.distance - b.distance);

  return withDistances.slice(0, numExemplars).map((w) => w.index);
}
