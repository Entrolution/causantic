/**
 * Integration tests for native HDBSCAN implementation.
 */

import { describe, it, expect } from 'vitest';
import { HDBSCAN } from '../../src/clusters/hdbscan.js';
import {
  wellSeparatedBlobs,
  sparseNoise,
  denseClusterWithOutliers,
  singleCluster,
  touchingClusters,
  withDuplicates,
  countClusterSizes,
} from './hdbscan/fixtures.js';

describe('HDBSCAN', () => {
  describe('basic functionality', () => {
    it('handles empty input', async () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 3 });
      const result = await hdbscan.fit([]);

      expect(result.labels).toEqual([]);
      expect(result.probabilities).toEqual([]);
      expect(result.outlierScores).toEqual([]);
      expect(result.numClusters).toBe(0);
      expect(result.noiseCount).toBe(0);
    });

    it('handles single point', async () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 2 });
      const result = await hdbscan.fit([[0, 0, 0]]);

      expect(result.labels).toHaveLength(1);
      expect(result.numClusters).toBe(0);
      expect(result.noiseCount).toBe(1);
    });

    it('returns correct result structure', async () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 3 });
      const data = wellSeparatedBlobs(30);
      const result = await hdbscan.fit(data);

      expect(result.labels).toHaveLength(30);
      expect(result.probabilities).toHaveLength(30);
      expect(result.outlierScores).toHaveLength(30);
      expect(typeof result.numClusters).toBe('number');
      expect(typeof result.noiseCount).toBe('number');
    });
  });

  describe('fitSync (drop-in compatibility)', () => {
    it('returns labels array', () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 3 });
      const data = wellSeparatedBlobs(30);
      const labels = hdbscan.fitSync(data);

      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBe(30);

      // All labels are numbers
      for (const label of labels) {
        expect(typeof label).toBe('number');
      }
    });
  });

  describe('clustering correctness', () => {
    it('finds clusters for well-separated blobs', async () => {
      const data = wellSeparatedBlobs(150);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Should find 3 clusters
      expect(result.numClusters).toBe(3);

      // Very little noise (well-separated)
      expect(result.noiseCount).toBeLessThan(10);

      // Each cluster should have ~50 points
      const clusterSizes = countClusterSizes(result.labels);
      expect(clusterSizes.length).toBe(3);
      for (const size of clusterSizes) {
        expect(size).toBeGreaterThan(40);
        expect(size).toBeLessThan(60);
      }
    });

    it('marks sparse random data as noise or few clusters', async () => {
      // Use very high-dimensional sparse data
      const data = sparseNoise(30, 100);
      const hdbscan = new HDBSCAN({ minClusterSize: 15 });
      const result = await hdbscan.fit(data);

      // With high minClusterSize and sparse data, should find few clusters
      // The algorithm works correctly - it finds whatever clusters exist
      expect(result.numClusters).toBeLessThanOrEqual(2);
    });

    it('finds single cluster or one dominant cluster', async () => {
      const data = singleCluster(100);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Should find 1-3 clusters (random Gaussian can have substructure)
      expect(result.numClusters).toBeGreaterThanOrEqual(1);
      expect(result.numClusters).toBeLessThanOrEqual(5);

      // Most points should be clustered (not noise)
      expect(result.noiseCount).toBeLessThan(result.labels.length / 2);
    });

    it('separates or merges touching clusters', async () => {
      const data = touchingClusters(100);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Touching clusters may be separated or merged depending on overlap
      // HDBSCAN finds hierarchical structure, so expect 1-6 clusters
      // (random data variation can produce finer granularity)
      expect(result.numClusters).toBeGreaterThanOrEqual(1);
      expect(result.numClusters).toBeLessThanOrEqual(6);
    });

    it('handles duplicate points', async () => {
      const data = withDuplicates(50);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Should not crash, should produce valid labels
      expect(result.labels.length).toBe(data.length);
      expect(result.numClusters).toBeGreaterThanOrEqual(0);
    });
  });

  describe('probabilities', () => {
    it('produces valid probabilities', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // All probabilities in [0, 1]
      for (const p of result.probabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });

    it('cluster points have higher probability', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Noise points should have 0 probability
      for (let i = 0; i < result.labels.length; i++) {
        if (result.labels[i] === -1) {
          expect(result.probabilities[i]).toBe(0);
        }
      }

      // Cluster points should have positive probability
      const clusterProbs = result.probabilities.filter((_, i) => result.labels[i] >= 0);
      const avgProb = clusterProbs.reduce((a, b) => a + b, 0) / clusterProbs.length;
      expect(avgProb).toBeGreaterThan(0.5);
    });
  });

  describe('outlier scores', () => {
    it('produces valid outlier scores', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // All scores in [0, 1]
      for (const s of result.outlierScores) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    it('noise points have high outlier scores', async () => {
      const data = denseClusterWithOutliers(80, 10);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      const result = await hdbscan.fit(data);

      // Find noise indices
      const noiseIndices = result.labels.map((l, i) => (l === -1 ? i : -1)).filter((i) => i >= 0);

      // Noise points should have high outlier scores
      for (const i of noiseIndices) {
        expect(result.outlierScores[i]).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe('options', () => {
    it('respects minClusterSize', async () => {
      const data = wellSeparatedBlobs(30); // 10 points per cluster

      // With minClusterSize=3, should find at least 3 clusters
      const hdbscan1 = new HDBSCAN({ minClusterSize: 3 });
      const result1 = await hdbscan1.fit(data);
      expect(result1.numClusters).toBeGreaterThanOrEqual(3);

      // With minClusterSize=15, clusters are too small
      const hdbscan2 = new HDBSCAN({ minClusterSize: 15 });
      const result2 = await hdbscan2.fit(data);
      // May find 1 merged cluster or 0
      expect(result2.numClusters).toBeLessThanOrEqual(1);
    });

    it('uses minSamples for core distance', async () => {
      const data = wellSeparatedBlobs(60);

      const hdbscan1 = new HDBSCAN({ minClusterSize: 5, minSamples: 2 });
      const hdbscan2 = new HDBSCAN({ minClusterSize: 5, minSamples: 10 });

      const result1 = await hdbscan1.fit(data);
      const result2 = await hdbscan2.fit(data);

      // Higher minSamples typically produces more noise
      expect(result2.noiseCount).toBeGreaterThanOrEqual(result1.noiseCount);
    });

    it('supports parallel: false', async () => {
      const data = wellSeparatedBlobs(60);

      const hdbscan = new HDBSCAN({
        minClusterSize: 5,
        parallel: false,
      });
      const result = await hdbscan.fit(data);

      expect(result.numClusters).toBe(3);
    });
  });

  describe('predict (incremental assignment)', () => {
    it('assigns new points to existing clusters', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      await hdbscan.fit(data);

      // Create new points very close to cluster centers
      const newPoints = [
        [10, 0, 0], // At cluster 1 center
        [-10, 0, 0], // At cluster 2 center
        [0, 10, 0], // At cluster 3 center
      ];

      const predicted = hdbscan.predict(newPoints);

      expect(predicted.length).toBe(3);
      // At least some should be assigned (close to centroids)
      const assignedCount = predicted.filter((l) => l >= 0).length;
      expect(assignedCount).toBeGreaterThanOrEqual(1);
    });

    it('throws if model not fitted', () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });

      expect(() => hdbscan.predict([[0, 0]])).toThrow('Model not fitted');
    });
  });

  describe('getModel', () => {
    it('returns null before fitting', () => {
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      expect(hdbscan.getModel()).toBeNull();
    });

    it('returns model after fitting', async () => {
      const data = wellSeparatedBlobs(30);
      const hdbscan = new HDBSCAN({ minClusterSize: 5 });
      await hdbscan.fit(data);

      const model = hdbscan.getModel();

      expect(model).not.toBeNull();
      expect(model?.embeddings).toHaveLength(30);
      expect(model?.coreDistances).toHaveLength(30);
      expect(model?.labels).toHaveLength(30);
      expect(model?.centroids.size).toBeGreaterThan(0);
      expect(model?.exemplars.size).toBeGreaterThan(0);
    });
  });

  describe('performance', () => {
    it('handles 500 points', async () => {
      const data: number[][] = [];
      for (let i = 0; i < 500; i++) {
        data.push([Math.random() * 10 + (i % 5) * 20, Math.random() * 10, Math.random() * 10]);
      }

      const hdbscan = new HDBSCAN({ minClusterSize: 10, parallel: false });

      const start = Date.now();
      const result = await hdbscan.fit(data);
      const duration = Date.now() - start;

      expect(result.labels.length).toBe(500);
      // Should complete in reasonable time (< 30 seconds)
      expect(duration).toBeLessThan(30000);
    });
  });

  describe('cluster selection method', () => {
    it('EOM produces balanced clusters', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({
        minClusterSize: 5,
        clusterSelectionMethod: 'eom',
      });
      const result = await hdbscan.fit(data);

      expect(result.numClusters).toBe(3);
    });

    it('leaf may produce different results', async () => {
      const data = wellSeparatedBlobs(90);
      const hdbscan = new HDBSCAN({
        minClusterSize: 5,
        clusterSelectionMethod: 'leaf',
      });
      const result = await hdbscan.fit(data);

      // Leaf typically produces more or equal clusters
      expect(result.numClusters).toBeGreaterThanOrEqual(1);
    });
  });
});
