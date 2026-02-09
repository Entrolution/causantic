/**
 * Distance cache for repeated clustering on the same dataset.
 * Useful when tuning parameters (minClusterSize sweep).
 */

import { euclideanDistance, angularDistance } from './kd-tree.js';

/**
 * Cache for pairwise distances.
 * Uses lazy computation - only calculates distances when requested.
 */
export class DistanceCache {
  private cache: Map<string, number>;
  private embeddings: number[][];
  private metric: 'euclidean' | 'angular';

  /**
   * Create a new distance cache.
   * @param embeddings The embeddings to compute distances for.
   * @param metric Distance metric to use.
   */
  constructor(embeddings: number[][], metric: 'euclidean' | 'angular' = 'euclidean') {
    this.cache = new Map();
    this.embeddings = embeddings;
    this.metric = metric;
  }

  /**
   * Get distance between two points by index.
   * Computes and caches if not already cached.
   */
  get(i: number, j: number): number {
    if (i === j) {
      return 0;
    }

    // Use canonical key (smaller index first)
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;

    let distance = this.cache.get(key);
    if (distance === undefined) {
      const distFn = this.metric === 'euclidean' ? euclideanDistance : angularDistance;
      distance = distFn(this.embeddings[i], this.embeddings[j]);
      this.cache.set(key, distance);
    }

    return distance;
  }

  /**
   * Pre-compute all pairwise distances.
   * Only use for small datasets (< 1000 points).
   */
  precomputeAll(): void {
    const n = this.embeddings.length;
    const distFn = this.metric === 'euclidean' ? euclideanDistance : angularDistance;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i}-${j}`;
        if (!this.cache.has(key)) {
          this.cache.set(key, distFn(this.embeddings[i], this.embeddings[j]));
        }
      }
    }
  }

  /**
   * Get the number of cached distances.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache hit rate (for diagnostics).
   */
  getHitRate(): { cached: number; total: number; rate: number } {
    const n = this.embeddings.length;
    const total = (n * (n - 1)) / 2;
    const cached = this.cache.size;
    return {
      cached,
      total,
      rate: total > 0 ? cached / total : 0,
    };
  }
}
