/**
 * Tests for the index entry differentiation experiment modules.
 *
 * Tests the similarity analysis and discrimination test logic with
 * synthetic embeddings and cluster data.
 */

import { describe, it, expect } from 'vitest';
import {
  analyseCluster,
  runSimilarityAnalysis,
} from '../../src/eval/experiments/index-differentiation/similarity-analysis.js';
import {
  testClusterDiscrimination,
  runDiscriminationTest,
} from '../../src/eval/experiments/index-differentiation/discrimination-test.js';
import type { ClusterForAnalysis } from '../../src/eval/experiments/index-differentiation/similarity-analysis.js';

/**
 * Create a unit vector in the given direction (angle in radians from [1,0,...]).
 * For simplicity, rotates in the first two dimensions.
 */
function makeVector(angle: number, dims: number = 8): number[] {
  const v = new Array(dims).fill(0);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

/**
 * Build a test cluster with controlled similarity.
 */
function makeCluster(
  id: string,
  entryAngles: number[],
  chunkAngles: number[],
  name?: string,
): ClusterForAnalysis {
  return {
    clusterId: id,
    clusterName: name ?? null,
    entries: entryAngles.map((angle, i) => ({
      entryId: `entry-${id}-${i}`,
      entryEmbedding: makeVector(angle),
      chunkEmbeddings: [makeVector(chunkAngles[i])],
    })),
  };
}

describe('similarity-analysis', () => {
  describe('analyseCluster', () => {
    it('detects homogenization when entries are more similar than chunks', () => {
      // Entries: all nearly the same direction (small angular spread)
      // Chunks: wider angular spread
      const cluster = makeCluster(
        'homogenized',
        [0.0, 0.05, 0.1], // entries close together
        [0.0, 0.5, 1.0], // chunks far apart
        'Homogenized Cluster',
      );

      const result = analyseCluster(cluster);

      expect(result.compressionRatio).toBeGreaterThan(1.0);
      expect(result.meanEntryPairSim).toBeGreaterThan(result.meanChunkPairSim);
      expect(result.entryCount).toBe(3);
      expect(result.chunkCount).toBe(3);
    });

    it('detects differentiation when entries are less similar than chunks', () => {
      // Entries: wide angular spread
      // Chunks: close together
      const cluster = makeCluster(
        'differentiated',
        [0.0, 0.8, 1.6], // entries spread out
        [0.0, 0.05, 0.1], // chunks close together
        'Differentiated Cluster',
      );

      const result = analyseCluster(cluster);

      expect(result.compressionRatio).toBeLessThan(1.0);
      expect(result.meanEntryPairSim).toBeLessThan(result.meanChunkPairSim);
    });

    it('returns ratio ~1 when entries and chunks have similar spread', () => {
      const angles = [0.0, 0.3, 0.6];
      const cluster = makeCluster('neutral', angles, angles, 'Neutral Cluster');

      const result = analyseCluster(cluster);

      expect(result.compressionRatio).toBeCloseTo(1.0, 1);
    });

    it('handles exactly 2 entries (minimum for pairwise comparison)', () => {
      const cluster = makeCluster('small', [0.0, 0.5], [0.0, 0.5]);
      const result = analyseCluster(cluster);

      expect(result.entryCount).toBe(2);
      expect(result.compressionRatio).toBeCloseTo(1.0, 1);
    });
  });

  describe('runSimilarityAnalysis', () => {
    it('analyses all clusters and returns results', () => {
      const clusters = [
        makeCluster('a', [0.0, 0.05, 0.1], [0.0, 0.5, 1.0]),
        makeCluster('b', [0.0, 0.8, 1.6], [0.0, 0.05, 0.1]),
      ];

      const results = runSimilarityAnalysis(clusters);

      expect(results).toHaveLength(2);
      expect(results[0].clusterId).toBe('a');
      expect(results[1].clusterId).toBe('b');
    });
  });
});

describe('discrimination-test', () => {
  describe('testClusterDiscrimination', () => {
    it('achieves perfect MRR when entries are orthogonal and match their chunks', () => {
      // Each entry embedding is the same direction as its chunk embedding,
      // and entries are far apart from each other
      const cluster: ClusterForAnalysis = {
        clusterId: 'perfect',
        clusterName: 'Perfect Discrimination',
        entries: [
          { entryId: 'e0', entryEmbedding: makeVector(0.0), chunkEmbeddings: [makeVector(0.0)] },
          { entryId: 'e1', entryEmbedding: makeVector(1.5), chunkEmbeddings: [makeVector(1.5)] },
          { entryId: 'e2', entryEmbedding: makeVector(3.0), chunkEmbeddings: [makeVector(3.0)] },
        ],
      };

      const result = testClusterDiscrimination(cluster);

      expect(result.meanReciprocalRank).toBeCloseTo(1.0, 2);
      expect(result.hitRate).toBeCloseTo(1.0, 2);
    });

    it('shows poor MRR when entries are all similar but chunks differ', () => {
      // Entry embeddings are nearly identical, but chunk embeddings are different
      // The chunk embedding may be closer to the wrong entry
      const cluster: ClusterForAnalysis = {
        clusterId: 'poor',
        clusterName: 'Poor Discrimination',
        entries: [
          { entryId: 'e0', entryEmbedding: makeVector(0.0), chunkEmbeddings: [makeVector(0.0)] },
          { entryId: 'e1', entryEmbedding: makeVector(0.01), chunkEmbeddings: [makeVector(1.0)] },
          { entryId: 'e2', entryEmbedding: makeVector(0.02), chunkEmbeddings: [makeVector(2.0)] },
        ],
      };

      const result = testClusterDiscrimination(cluster);

      // With entries nearly identical, chunks at angle 1.0 and 2.0 won't
      // reliably find the right entry among the ~identical options
      expect(result.meanReciprocalRank).toBeLessThan(0.9);
    });

    it('returns entryCount matching input', () => {
      const cluster = makeCluster('test', [0.0, 0.5, 1.0], [0.0, 0.5, 1.0]);
      const result = testClusterDiscrimination(cluster);

      expect(result.entryCount).toBe(3);
      expect(result.perEntry).toHaveLength(3);
    });

    it('handles entries with missing chunk embeddings', () => {
      const cluster: ClusterForAnalysis = {
        clusterId: 'missing',
        clusterName: null,
        entries: [
          { entryId: 'e0', entryEmbedding: makeVector(0.0), chunkEmbeddings: [] },
          { entryId: 'e1', entryEmbedding: makeVector(0.5), chunkEmbeddings: [makeVector(0.5)] },
          { entryId: 'e2', entryEmbedding: makeVector(1.0), chunkEmbeddings: [makeVector(1.0)] },
        ],
      };

      const result = testClusterDiscrimination(cluster);

      // Should not throw; the missing entry gets worst rank
      expect(result.perEntry).toHaveLength(3);
      expect(result.perEntry[0].rankAmongSiblings).toBe(3); // worst
    });
  });

  describe('runDiscriminationTest', () => {
    it('returns results for all clusters', () => {
      const clusters = [
        makeCluster('a', [0.0, 1.0, 2.0], [0.0, 1.0, 2.0]),
        makeCluster('b', [0.0, 0.5, 1.0], [0.0, 0.5, 1.0]),
      ];

      const results = runDiscriminationTest(clusters);

      expect(results).toHaveLength(2);
      expect(results[0].clusterId).toBe('a');
      expect(results[1].clusterId).toBe('b');
    });
  });
});
