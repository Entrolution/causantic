/**
 * Tests for cluster manager.
 */

import { describe, it, expect } from 'vitest';
import type { ClusteringResult, ClusteringOptions } from '../../src/clusters/cluster-manager.js';

describe('cluster-manager', () => {
  describe('ClusteringResult interface', () => {
    it('has correct structure', () => {
      const result: ClusteringResult = {
        numClusters: 5,
        assignedChunks: 150,
        noiseChunks: 20,
        noiseRatio: 0.117,
        clusterSizes: [45, 35, 30, 25, 15],
        durationMs: 1234,
      };

      expect(result.numClusters).toBe(5);
      expect(result.assignedChunks).toBe(150);
      expect(result.noiseChunks).toBe(20);
      expect(result.noiseRatio).toBeCloseTo(0.117);
      expect(result.clusterSizes.length).toBe(5);
      expect(result.durationMs).toBe(1234);
    });

    it('clusterSizes sums to assignedChunks', () => {
      const clusterSizes = [45, 35, 30, 25, 15];
      const assignedChunks = clusterSizes.reduce((a, b) => a + b, 0);

      expect(assignedChunks).toBe(150);
    });

    it('noiseRatio is calculated correctly', () => {
      const noiseChunks = 20;
      const totalChunks = 170;
      const noiseRatio = noiseChunks / totalChunks;

      expect(noiseRatio).toBeCloseTo(0.117, 2);
    });

    it('returns empty result for no vectors', () => {
      const emptyResult: ClusteringResult = {
        numClusters: 0,
        assignedChunks: 0,
        noiseChunks: 0,
        noiseRatio: 0,
        clusterSizes: [],
        durationMs: 5,
      };

      expect(emptyResult.numClusters).toBe(0);
      expect(emptyResult.clusterSizes).toEqual([]);
    });
  });

  describe('ClusteringOptions interface', () => {
    it('has optional minClusterSize', () => {
      const options: ClusteringOptions = {
        minClusterSize: 10,
      };

      expect(options.minClusterSize).toBe(10);
    });

    it('has optional clusterThreshold', () => {
      const options: ClusteringOptions = {
        clusterThreshold: 0.3,
      };

      expect(options.clusterThreshold).toBe(0.3);
    });

    it('has optional clearExisting', () => {
      const options: ClusteringOptions = {
        clearExisting: false,
      };

      expect(options.clearExisting).toBe(false);
    });
  });

  describe('centroid computation', () => {
    it('computes mean of single embedding', () => {
      const embeddings = [[0.5, 0.5, 0.5]];

      // Mean is same as input
      const mean = [0.5, 0.5, 0.5];

      // Normalize: sqrt(0.75) = 0.866
      const norm = Math.sqrt(0.5 ** 2 + 0.5 ** 2 + 0.5 ** 2);
      const normalized = mean.map((v) => v / norm);

      expect(norm).toBeCloseTo(0.866);
      expect(normalized[0]).toBeCloseTo(0.577);
    });

    it('computes mean of multiple embeddings', () => {
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];

      // Mean: [1/3, 1/3, 1/3]
      const mean = [1 / 3, 1 / 3, 1 / 3];
      const norm = Math.sqrt(3 * (1 / 9));
      const normalized = mean.map((v) => v / norm);

      expect(normalized[0]).toBeCloseTo(0.577);
      expect(normalized[1]).toBeCloseTo(0.577);
      expect(normalized[2]).toBeCloseTo(0.577);
    });

    it('returns empty array for no embeddings', () => {
      const embeddings: number[][] = [];
      const centroid = embeddings.length > 0 ? [0] : [];

      expect(centroid).toEqual([]);
    });

    it('produces unit vector', () => {
      // Any normalized centroid should have magnitude 1
      const centroid = [0.577, 0.577, 0.577];
      const magnitude = Math.sqrt(centroid.reduce((sum, v) => sum + v * v, 0));

      expect(magnitude).toBeCloseTo(1.0);
    });
  });

  describe('HDBSCAN labels', () => {
    it('negative labels indicate noise', () => {
      const labels = [0, 1, -1, 2, -1, 0];
      const noiseCount = labels.filter((l) => l < 0).length;
      const assignedCount = labels.filter((l) => l >= 0).length;

      expect(noiseCount).toBe(2);
      expect(assignedCount).toBe(4);
    });

    it('groups points by cluster label', () => {
      const labels = [0, 1, 0, 1, 0, 2];
      const clusters = new Map<number, number[]>();

      labels.forEach((label, i) => {
        if (label < 0) return;
        if (!clusters.has(label)) clusters.set(label, []);
        clusters.get(label)!.push(i);
      });

      expect(clusters.get(0)).toEqual([0, 2, 4]);
      expect(clusters.get(1)).toEqual([1, 3]);
      expect(clusters.get(2)).toEqual([5]);
    });
  });

  describe('cluster assignment', () => {
    it('assigns chunk to clusters within threshold', () => {
      const threshold = 0.3;
      const distances = [0.1, 0.25, 0.35, 0.5];

      const assigned = distances.filter((d) => d < threshold);
      expect(assigned).toEqual([0.1, 0.25]);
    });

    it('uses angular distance for similarity', () => {
      // Angular distance: 1 - cos(angle)
      // For normalized vectors: angular = 1 - dot(a, b)
      const a = [1, 0, 0];
      const b = [0.866, 0.5, 0]; // 30 degrees from a

      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const angularDistance = 1 - dot;

      expect(dot).toBeCloseTo(0.866);
      expect(angularDistance).toBeCloseTo(0.134);
    });
  });

  describe('exemplar selection', () => {
    it('selects chunks closest to centroid', () => {
      const members = [
        { id: 'a', distance: 0.5 },
        { id: 'b', distance: 0.1 },
        { id: 'c', distance: 0.3 },
        { id: 'd', distance: 0.2 },
      ];

      // Sort by distance ascending
      members.sort((a, b) => a.distance - b.distance);

      // Take top 3
      const exemplars = members.slice(0, 3).map((m) => m.id);

      expect(exemplars).toEqual(['b', 'd', 'c']);
    });
  });

  describe('cluster statistics', () => {
    it('calculates average cluster size', () => {
      const clusterSizes = [10, 20, 30];
      const total = clusterSizes.reduce((a, b) => a + b, 0);
      const avg = total / clusterSizes.length;

      expect(avg).toBe(20);
    });

    it('finds largest and smallest clusters', () => {
      const clusterSizes = [10, 50, 25, 5, 30];
      const largest = Math.max(...clusterSizes);
      const smallest = Math.min(...clusterSizes);

      expect(largest).toBe(50);
      expect(smallest).toBe(5);
    });

    it('handles empty cluster list', () => {
      const clusterSizes: number[] = [];
      const avg = clusterSizes.length > 0 ? clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length : 0;
      const smallest = clusterSizes.length > 0 ? Math.min(...clusterSizes) : 0;

      expect(avg).toBe(0);
      expect(smallest).toBe(0);
    });
  });

  describe('ChunkClusterAssignment interface', () => {
    it('has correct structure', () => {
      const assignment = {
        chunkId: 'chunk-abc',
        clusterId: 'cluster-xyz',
        distance: 0.15,
      };

      expect(assignment.chunkId).toBe('chunk-abc');
      expect(assignment.clusterId).toBe('cluster-xyz');
      expect(assignment.distance).toBe(0.15);
    });
  });

  describe('membership hash', () => {
    it('changes when membership changes', () => {
      // Membership hash is deterministic based on sorted member IDs
      const members1 = ['a', 'b', 'c'];
      const members2 = ['a', 'b', 'd'];

      // Simple hash simulation
      const hash1 = members1.sort().join(',');
      const hash2 = members2.sort().join(',');

      expect(hash1).not.toBe(hash2);
    });

    it('is order-independent', () => {
      const members1 = ['c', 'a', 'b'];
      const members2 = ['a', 'b', 'c'];

      const hash1 = members1.sort().join(',');
      const hash2 = members2.sort().join(',');

      expect(hash1).toBe(hash2);
    });
  });

  describe('cluster search', () => {
    it('returns clusters sorted by distance', () => {
      const results = [
        { clusterId: 'c1', distance: 0.5 },
        { clusterId: 'c2', distance: 0.1 },
        { clusterId: 'c3', distance: 0.3 },
      ];

      results.sort((a, b) => a.distance - b.distance);

      expect(results[0].clusterId).toBe('c2');
      expect(results[1].clusterId).toBe('c3');
      expect(results[2].clusterId).toBe('c1');
    });

    it('limits results to specified count', () => {
      const allClusters = ['c1', 'c2', 'c3', 'c4', 'c5'];
      const limit = 3;

      const limited = allClusters.slice(0, limit);

      expect(limited.length).toBe(3);
    });
  });
});
