/**
 * Worker thread for parallel core distance computation.
 * This file is loaded by worker_threads.
 */

import { parentPort, workerData } from 'worker_threads';
import type { CoreDistanceWorkerData, CoreDistanceWorkerResult } from './types.js';
import { quickselect } from '../../utils/array-utils.js';

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
