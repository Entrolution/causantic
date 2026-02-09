/**
 * HDBSCAN performance benchmark.
 * Compares native implementation against hdbscan-ts.
 */

import { HDBSCAN } from '../../src/clusters/hdbscan.js';
// @ts-ignore - hdbscan-ts types
import { HDBSCAN as OldHDBSCAN } from 'hdbscan-ts';

interface BenchmarkResult {
  ms: number | string;
  numClusters?: number;
  noiseCount?: number;
}

function generateRandomEmbeddings(n: number, dim: number): number[][] {
  const embeddings: number[][] = [];

  // Create 5 clusters
  const numClusters = 5;
  const pointsPerCluster = Math.floor(n / numClusters);

  for (let c = 0; c < numClusters; c++) {
    // Random center for each cluster
    const center = new Array(dim).fill(0).map(() => Math.random() * 20 - 10);

    for (let i = 0; i < pointsPerCluster; i++) {
      const point = center.map((v) => v + (Math.random() - 0.5) * 2);
      embeddings.push(point);
    }
  }

  // Add remaining points as noise
  while (embeddings.length < n) {
    embeddings.push(new Array(dim).fill(0).map(() => Math.random() * 100 - 50));
  }

  return embeddings;
}

function benchmarkFn<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  return { ms: Math.round(ms), value };
}

async function benchmarkAsyncFn<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  return { ms: Math.round(ms), value };
}

async function runBenchmarks() {
  console.log('HDBSCAN Performance Benchmark');
  console.log('=============================\n');

  const dim = 128; // Typical embedding dimension
  const sizes = [100, 250, 500, 750, 1000, 1500, 2000];

  console.log('| Size | Native (parallel) | Native (single) | hdbscan-ts |');
  console.log('|------|-------------------|-----------------|------------|');

  for (const size of sizes) {
    const embeddings = generateRandomEmbeddings(size, dim);

    // Native parallel (default)
    let nativeParallel: BenchmarkResult;
    try {
      const result = await benchmarkAsyncFn(async () => {
        const h = new HDBSCAN({ minClusterSize: 4, parallel: true });
        return h.fit(embeddings);
      });
      nativeParallel = { ms: result.ms, numClusters: result.value.numClusters };
    } catch (e) {
      nativeParallel = { ms: 'error' };
    }

    // Native single-threaded
    let nativeSingle: BenchmarkResult;
    try {
      const result = await benchmarkAsyncFn(async () => {
        const h = new HDBSCAN({ minClusterSize: 4, parallel: false });
        return h.fit(embeddings);
      });
      nativeSingle = { ms: result.ms, numClusters: result.value.numClusters };
    } catch (e) {
      nativeSingle = { ms: 'error' };
    }

    // Old hdbscan-ts (skip for large sizes due to performance)
    let oldLib: BenchmarkResult;
    if (size <= 1000) {
      try {
        const result = benchmarkFn(() => {
          const h = new OldHDBSCAN({ minClusterSize: 4, minSamples: 4 });
          return h.fit(embeddings);
        });
        const labels = result.value as number[];
        const numClusters = new Set(labels.filter((l: number) => l >= 0)).size;
        oldLib = { ms: result.ms, numClusters };
      } catch (e) {
        oldLib = { ms: 'error' };
      }
    } else {
      oldLib = { ms: 'skip' };
    }

    console.log(
      `| ${size.toString().padEnd(4)} | ${String(nativeParallel.ms).padEnd(17)}ms | ${String(nativeSingle.ms).padEnd(15)}ms | ${String(oldLib.ms).padEnd(10)}ms |`
    );
  }

  console.log('\n--- Large Dataset Test ---');

  // Test with larger dataset
  const largeSize = 3000;
  console.log(`\nClustering ${largeSize} points (${dim}D)...`);

  const largeData = generateRandomEmbeddings(largeSize, dim);

  const largeResult = await benchmarkAsyncFn(async () => {
    const h = new HDBSCAN({ minClusterSize: 4, parallel: false });
    return h.fit(largeData);
  });

  console.log(`Duration: ${largeResult.ms}ms`);
  console.log(`Clusters: ${largeResult.value.numClusters}`);
  console.log(`Noise: ${largeResult.value.noiseCount}`);

  // Test with different options
  console.log('\n--- Option Comparison (1000 points) ---');
  const testData = generateRandomEmbeddings(1000, dim);

  // Default (parallel)
  const defaultResult = await benchmarkAsyncFn(async () => {
    const h = new HDBSCAN({ minClusterSize: 4 });
    return h.fit(testData);
  });
  console.log(`Default (parallel): ${defaultResult.ms}ms`);

  // Single-threaded
  const singleResult = await benchmarkAsyncFn(async () => {
    const h = new HDBSCAN({ minClusterSize: 4, parallel: false });
    return h.fit(testData);
  });
  console.log(`Single-threaded: ${singleResult.ms}ms`);

  // With approximate k-NN
  const approxResult = await benchmarkAsyncFn(async () => {
    const h = new HDBSCAN({ minClusterSize: 4, approximateKNN: true, parallel: false });
    return h.fit(testData);
  });
  console.log(`Approximate k-NN: ${approxResult.ms}ms`);

  console.log('\n--- Cluster Quality Comparison ---');
  console.log(`Native clusters: ${defaultResult.value.numClusters}, noise: ${defaultResult.value.noiseCount}`);

  try {
    const oldH = new OldHDBSCAN({ minClusterSize: 4, minSamples: 4 });
    const oldLabels = oldH.fit(testData) as number[];
    const oldClusters = new Set(oldLabels.filter((l: number) => l >= 0)).size;
    const oldNoise = oldLabels.filter((l: number) => l < 0).length;
    console.log(`hdbscan-ts clusters: ${oldClusters}, noise: ${oldNoise}`);
  } catch (e) {
    console.log('hdbscan-ts: error');
  }
}

runBenchmarks().catch(console.error);
