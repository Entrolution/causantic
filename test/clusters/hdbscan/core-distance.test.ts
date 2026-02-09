/**
 * Tests for core distance computation.
 */

import { describe, it, expect } from 'vitest';
import { computeCoreDistances, computeCoreDistancesChunk } from '../../../src/clusters/hdbscan/core-distance.js';

describe('computeCoreDistances', () => {
  describe('basic functionality', () => {
    it('handles empty input', () => {
      const result = computeCoreDistances([], 5);
      expect(result).toEqual([]);
    });

    it('handles single point', () => {
      const result = computeCoreDistances([[0, 0]], 5);
      expect(result).toEqual([0]);
    });

    it('handles k=1', () => {
      const points = [
        [0, 0],
        [1, 0],
        [10, 0],
      ];

      const result = computeCoreDistances(points, 1);

      // Core distance is distance to 1st nearest neighbor
      expect(result[0]).toBe(1); // [0,0] -> [1,0] = 1
      expect(result[1]).toBe(1); // [1,0] -> [0,0] = 1
      expect(result[2]).toBe(9); // [10,0] -> [1,0] = 9
    });

    it('computes correct k-th nearest neighbor distance', () => {
      const points = [
        [0, 0],
        [1, 0],
        [3, 0],
        [10, 0],
      ];

      const result = computeCoreDistances(points, 2);

      // k=2 means distance to 2nd nearest neighbor
      expect(result[0]).toBe(3); // [0,0]: neighbors at 1, 3, 10 -> 2nd nearest = 3
      expect(result[1]).toBe(2); // [1,0]: neighbors at 1, 2, 9 -> 2nd nearest = 2
      expect(result[2]).toBe(3); // [3,0]: neighbors at 2, 3, 7 -> 2nd nearest = 3
      expect(result[3]).toBe(9); // [10,0]: neighbors at 7, 9, 10 -> 2nd nearest = 9
    });

    it('handles k > n-1 gracefully', () => {
      const points = [
        [0, 0],
        [1, 0],
      ];

      const result = computeCoreDistances(points, 10);

      // k is clamped to n-1 = 1
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(1);
    });
  });

  describe('metrics', () => {
    it('uses euclidean distance by default', () => {
      const points = [
        [0, 0],
        [3, 4],
      ];

      const result = computeCoreDistances(points, 1, 'euclidean');
      expect(result[0]).toBe(5);
      expect(result[1]).toBe(5);
    });

    it('supports angular distance', () => {
      const points = [
        [1, 0],
        [0, 1],
        [1, 0], // Duplicate of first
      ];

      const result = computeCoreDistances(points, 1, 'angular');

      // [1,0] -> [1,0] = 0 angular distance
      expect(result[0]).toBeCloseTo(0);
      expect(result[2]).toBeCloseTo(0);

      // [0,1] -> [1,0] = 1 angular distance
      expect(result[1]).toBeCloseTo(1);
    });
  });

  describe('with KD-tree', () => {
    it('produces similar results to brute force', () => {
      const points: number[][] = [];
      for (let i = 0; i < 50; i++) {
        points.push([Math.random() * 10, Math.random() * 10]);
      }

      const bruteForce = computeCoreDistances(points, 5, 'euclidean', false);
      const kdTree = computeCoreDistances(points, 5, 'euclidean', true);

      // Results should be identical
      for (let i = 0; i < points.length; i++) {
        expect(kdTree[i]).toBeCloseTo(bruteForce[i], 6);
      }
    });
  });
});

describe('computeCoreDistancesChunk', () => {
  it('computes core distances for specified indices', () => {
    const points = [
      [0, 0],
      [1, 0],
      [3, 0],
      [10, 0],
    ];

    const result = computeCoreDistancesChunk([0, 2], points, 2);

    expect(result.length).toBe(2);

    const idx0 = result.find((r) => r.index === 0);
    const idx2 = result.find((r) => r.index === 2);

    expect(idx0?.coreDistance).toBe(3); // [0,0]: neighbors at 1, 3, 10 -> 2nd nearest = 3
    expect(idx2?.coreDistance).toBe(3); // [3,0]: neighbors at 2, 3, 7 -> 2nd nearest = 3
  });

  it('works with angular metric', () => {
    const points = [
      [1, 0],
      [0.707, 0.707], // 45 degrees
      [0, 1], // 90 degrees
    ];

    const result = computeCoreDistancesChunk([0], points, 1, 'angular');

    expect(result.length).toBe(1);
    expect(result[0].index).toBe(0);
    // Angular distance to [0.707, 0.707] is 1 - 0.707 ≈ 0.293
    expect(result[0].coreDistance).toBeCloseTo(1 - 0.707, 2);
  });
});
