/**
 * Synthetic test fixtures for HDBSCAN tests.
 * Tests verify geometric invariants rather than matching Python output.
 */

/**
 * Generate random Gaussian samples around a center.
 */
function gaussianSamples(center: number[], variance: number, count: number): number[][] {
  const samples: number[][] = [];

  for (let i = 0; i < count; i++) {
    const point = center.map((c) => {
      // Box-Muller transform for Gaussian
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return c + z * Math.sqrt(variance);
    });
    samples.push(point);
  }

  return samples;
}

/**
 * Generate well-separated blobs.
 * Should find exactly 3 clusters with very little noise.
 */
export function wellSeparatedBlobs(n: number = 150): number[][] {
  const pointsPerCluster = Math.floor(n / 3);

  const cluster1 = gaussianSamples([10, 0, 0], 0.5, pointsPerCluster);
  const cluster2 = gaussianSamples([-10, 0, 0], 0.5, pointsPerCluster);
  const cluster3 = gaussianSamples([0, 10, 0], 0.5, pointsPerCluster);

  return [...cluster1, ...cluster2, ...cluster3];
}

/**
 * Generate concentric rings (tests density-based separation).
 * Should find 2 clusters (inner and outer ring).
 */
export function concentricRings(n: number = 200): number[][] {
  const innerCount = Math.floor(n / 2);
  const outerCount = n - innerCount;
  const points: number[][] = [];

  // Inner ring (radius 1)
  for (let i = 0; i < innerCount; i++) {
    const angle = (2 * Math.PI * i) / innerCount + Math.random() * 0.1;
    const r = 1 + (Math.random() - 0.5) * 0.2;
    points.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }

  // Outer ring (radius 3)
  for (let i = 0; i < outerCount; i++) {
    const angle = (2 * Math.PI * i) / outerCount + Math.random() * 0.1;
    const r = 3 + (Math.random() - 0.5) * 0.2;
    points.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }

  return points;
}

/**
 * Generate sparse random points (all noise).
 * Should find 0 clusters, all points as noise.
 */
export function sparseNoise(n: number = 100, dim: number = 10): number[][] {
  const points: number[][] = [];

  for (let i = 0; i < n; i++) {
    const point: number[] = [];
    for (let d = 0; d < dim; d++) {
      point.push(Math.random() * 100);
    }
    points.push(point);
  }

  return points;
}

/**
 * Generate dense cluster with outliers.
 * Should find 1 cluster, outliers as noise with high outlier scores.
 */
export function denseClusterWithOutliers(
  clusterSize: number = 100,
  numOutliers: number = 10,
): number[][] {
  // Dense cluster at origin
  const cluster = gaussianSamples([0, 0, 0], 0.3, clusterSize);

  // Outliers far from cluster
  const outliers: number[][] = [];
  for (let i = 0; i < numOutliers; i++) {
    const angle = (2 * Math.PI * i) / numOutliers;
    outliers.push([50 + Math.random() * 10, 50 * Math.sin(angle), 50 * Math.cos(angle)]);
  }

  return [...cluster, ...outliers];
}

/**
 * Generate clusters with varying density.
 * Tests HDBSCAN's ability to find clusters of different densities.
 */
export function varyingDensity(): number[][] {
  // Dense cluster (variance 0.1)
  const dense = gaussianSamples([0, 0], 0.1, 50);

  // Medium density cluster (variance 0.5)
  const medium = gaussianSamples([10, 0], 0.5, 50);

  // Sparse cluster (variance 1.0)
  const sparse = gaussianSamples([0, 10], 1.0, 50);

  return [...dense, ...medium, ...sparse];
}

/**
 * Generate a single compact cluster.
 * Should find exactly 1 cluster with all points assigned.
 */
export function singleCluster(n: number = 100): number[][] {
  return gaussianSamples([0, 0, 0], 0.5, n);
}

/**
 * Generate two touching clusters.
 * Tests cluster separation at boundaries.
 */
export function touchingClusters(n: number = 100): number[][] {
  const half = Math.floor(n / 2);

  const cluster1 = gaussianSamples([0, 0], 1.0, half);
  const cluster2 = gaussianSamples([3, 0], 1.0, n - half);

  return [...cluster1, ...cluster2];
}

/**
 * Generate high-dimensional data (like real embeddings).
 */
export function highDimensional(n: number = 200, dim: number = 128): number[][] {
  const pointsPerCluster = Math.floor(n / 4);

  // 4 clusters in high-dimensional space
  const centers = [
    new Array(dim).fill(0).map((_, i) => (i < dim / 4 ? 1 : 0)),
    new Array(dim).fill(0).map((_, i) => (i >= dim / 4 && i < dim / 2 ? 1 : 0)),
    new Array(dim).fill(0).map((_, i) => (i >= dim / 2 && i < (3 * dim) / 4 ? 1 : 0)),
    new Array(dim).fill(0).map((_, i) => (i >= (3 * dim) / 4 ? 1 : 0)),
  ];

  const points: number[][] = [];
  for (const center of centers) {
    points.push(...gaussianSamples(center, 0.1, pointsPerCluster));
  }

  return points;
}

/**
 * Generate data with duplicate points.
 * Tests handling of identical points.
 */
export function withDuplicates(n: number = 50): number[][] {
  const base = gaussianSamples([0, 0, 0], 0.5, n);

  // Add duplicates of some points
  const duplicates = base.slice(0, 10).map((p) => [...p]);

  return [...base, ...duplicates];
}

/**
 * Count cluster sizes from labels.
 */
export function countClusterSizes(labels: number[]): number[] {
  const counts = new Map<number, number>();

  for (const label of labels) {
    if (label >= 0) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return Array.from(counts.values()).sort((a, b) => b - a);
}

/**
 * Count noise points.
 */
export function countNoise(labels: number[]): number {
  return labels.filter((l) => l < 0).length;
}

/**
 * Get unique cluster labels (excluding noise).
 */
export function getUniqueClusters(labels: number[]): number[] {
  return [...new Set(labels.filter((l) => l >= 0))].sort((a, b) => a - b);
}
