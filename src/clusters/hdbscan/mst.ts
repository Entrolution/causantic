/**
 * Minimum Spanning Tree construction using Prim's algorithm.
 * Uses mutual reachability distance for HDBSCAN.
 */

import { MinHeap } from './min-heap.js';
import { euclideanDistance, angularDistance } from './kd-tree.js';
import type { MSTEdge } from './types.js';

/**
 * Build a minimum spanning tree using Prim's algorithm.
 * Uses mutual reachability distance: MRD(a, b) = max(core(a), core(b), dist(a, b))
 *
 * @param points All points (embeddings).
 * @param coreDistances Core distance for each point.
 * @param metric Distance metric.
 * @returns MST edges sorted by weight (ascending).
 */
export function buildMST(
  points: number[][],
  coreDistances: number[],
  metric: 'euclidean' | 'angular' = 'euclidean'
): MSTEdge[] {
  const n = points.length;

  if (n <= 1) {
    return [];
  }

  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;
  const edges: MSTEdge[] = [];
  const inMST = new Set<number>();
  const heap = new MinHeap<number>();

  // Start from vertex 0
  inMST.add(0);

  // Add all edges from vertex 0 to the heap
  for (let i = 1; i < n; i++) {
    const dist = distFn(points[0], points[i]);
    const mrd = Math.max(coreDistances[0], coreDistances[i], dist);
    heap.insert(mrd, i);
  }

  // Track the closest MST vertex for each non-MST vertex
  const closestMSTVertex = new Array<number>(n).fill(0);

  while (edges.length < n - 1 && !heap.isEmpty()) {
    const entry = heap.extractMin()!;
    const v = entry.value;
    const weight = entry.key;

    if (inMST.has(v)) {
      continue;
    }

    // Add edge to MST
    const from = closestMSTVertex[v];
    edges.push({ from, to: v, weight });
    inMST.add(v);

    // Update heap with edges from new vertex
    for (let u = 0; u < n; u++) {
      if (!inMST.has(u)) {
        const dist = distFn(points[v], points[u]);
        const mrd = Math.max(coreDistances[v], coreDistances[u], dist);

        const currentKey = heap.getKey(u);
        if (currentKey !== undefined) {
          if (mrd < currentKey) {
            heap.decreaseKey(u, mrd);
            closestMSTVertex[u] = v;
          }
        } else {
          heap.insert(mrd, u);
          closestMSTVertex[u] = v;
        }
      }
    }
  }

  // Sort edges by weight for hierarchy construction
  edges.sort((a, b) => a.weight - b.weight);

  return edges;
}

/**
 * Compute mutual reachability distance between two points.
 */
export function mutualReachabilityDistance(
  pointA: number[],
  pointB: number[],
  coreDistA: number,
  coreDistB: number,
  metric: 'euclidean' | 'angular' = 'euclidean'
): number {
  const distFn = metric === 'euclidean' ? euclideanDistance : angularDistance;
  const rawDist = distFn(pointA, pointB);
  return Math.max(coreDistA, coreDistB, rawDist);
}
