/**
 * Worker thread for parallel core distance computation.
 * This file is loaded by worker_threads.
 */

import { parentPort, workerData } from 'worker_threads';
import type { CoreDistanceWorkerData, CoreDistanceWorkerResult } from './types.js';

/**
 * Compute Euclidean distance between two points.
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compute angular distance between two normalized vectors.
 */
function angularDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}

/**
 * Quickselect to find k-th smallest element.
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
 * Compute core distances for assigned indices.
 */
function computeChunk(data: CoreDistanceWorkerData): CoreDistanceWorkerResult {
  const { indices, allPoints, k, metric } = data;
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;
  const n = allPoints.length;
  const effectiveK = Math.min(k, n - 1);
  const coreDistances: Array<{ index: number; coreDistance: number }> = [];

  for (const i of indices) {
    const distances: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        distances.push(distFn(allPoints[i], allPoints[j]));
      }
    }

    const coreDistance = effectiveK > 0 ? quickselect(distances, effectiveK - 1) : 0;
    coreDistances.push({ index: i, coreDistance });
  }

  return { coreDistances };
}

// Run computation and send result back
if (parentPort && workerData) {
  const result = computeChunk(workerData as CoreDistanceWorkerData);
  parentPort.postMessage(result);
}
