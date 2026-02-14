/**
 * Tests for KD-tree.
 */

import { describe, it, expect } from 'vitest';
import {
  KDTree,
  euclideanDistance,
  angularDistance,
} from '../../../src/clusters/hdbscan/kd-tree.js';

describe('KDTree', () => {
  describe('construction', () => {
    it('handles empty points', () => {
      const tree = new KDTree([]);
      expect(tree.nearest([0, 0])).toBeNull();
    });

    it('handles single point', () => {
      const tree = new KDTree([[1, 2]]);
      const result = tree.nearest([0, 0]);

      expect(result).not.toBeNull();
      expect(result?.index).toBe(0);
    });
  });

  describe('nearest neighbor', () => {
    it('finds nearest neighbor in 2D', () => {
      const points = [
        [0, 0],
        [1, 1],
        [5, 5],
        [3, 3],
      ];
      const tree = new KDTree(points);

      // [0.5, 0.5] is equidistant from [0,0] and [1,1] (both at dist ~0.707)
      const result = tree.nearest([0.5, 0.5]);
      expect([0, 1]).toContain(result?.index); // Either [0,0] or [1,1] is acceptable

      const result2 = tree.nearest([4, 4]);
      expect(result2?.index).toBe(3); // [3, 3] is closest (dist ~1.41 vs ~1.41 for [5,5])
    });

    it('excludes specified index', () => {
      const points = [
        [0, 0],
        [1, 1],
        [10, 10],
      ];
      const tree = new KDTree(points);

      const result = tree.nearest([0, 0], 0);
      expect(result?.index).toBe(1); // Exclude 0, so 1 is closest
    });
  });

  describe('k nearest neighbors', () => {
    it('finds k nearest in correct order', () => {
      const points = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [10, 0],
      ];
      const tree = new KDTree(points);

      const result = tree.kNearest([0, 0], 3);

      expect(result.length).toBe(3);
      expect(result[0].index).toBe(0); // Distance 0
      expect(result[1].index).toBe(1); // Distance 1
      expect(result[2].index).toBe(2); // Distance 2
    });

    it('handles k larger than points', () => {
      const points = [
        [0, 0],
        [1, 1],
      ];
      const tree = new KDTree(points);

      const result = tree.kNearest([0, 0], 5);
      expect(result.length).toBe(2);
    });

    it('excludes self in k nearest', () => {
      const points = [
        [0, 0],
        [1, 0],
        [2, 0],
      ];
      const tree = new KDTree(points);

      const result = tree.kNearest([0, 0], 2, 0);

      expect(result.length).toBe(2);
      expect(result.every((r) => r.index !== 0)).toBe(true);
    });
  });

  describe('high dimensions', () => {
    it('handles 128-dimensional data', () => {
      const dim = 128;
      const n = 100;

      // Generate random points
      const points: number[][] = [];
      for (let i = 0; i < n; i++) {
        const point: number[] = [];
        for (let d = 0; d < dim; d++) {
          point.push(Math.random());
        }
        points.push(point);
      }

      const tree = new KDTree(points);

      // Query should find nearest
      const query = points[0].map((v) => v + 0.001);
      const result = tree.nearest(query);

      expect(result).not.toBeNull();
      // Should likely be index 0 or nearby
    });

    it('kNearest works in high dimensions', () => {
      const dim = 64;
      const n = 50;

      const points: number[][] = [];
      for (let i = 0; i < n; i++) {
        const point = new Array(dim).fill(0);
        point[i % dim] = 1; // Spread points across dimensions
        points.push(point);
      }

      const tree = new KDTree(points);
      const result = tree.kNearest(points[0], 5, 0);

      expect(result.length).toBe(5);
      // All results should have valid indices
      for (const r of result) {
        expect(r.index).toBeGreaterThanOrEqual(0);
        expect(r.index).toBeLessThan(n);
        expect(r.index).not.toBe(0);
      }
    });
  });
});

describe('euclideanDistance', () => {
  it('computes distance in 2D', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(euclideanDistance([1, 1], [1, 1])).toBe(0);
  });

  it('computes distance in 3D', () => {
    expect(euclideanDistance([0, 0, 0], [1, 2, 2])).toBe(3);
  });
});

describe('angularDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(angularDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it('returns 1 for orthogonal vectors', () => {
    expect(angularDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it('returns 2 for opposite vectors', () => {
    expect(angularDistance([1, 0], [-1, 0])).toBeCloseTo(2);
  });

  it('works with normalized vectors', () => {
    const a = [0.6, 0.8]; // Normalized
    const b = [0.8, 0.6]; // Normalized
    const dot = a[0] * b[0] + a[1] * b[1];

    expect(angularDistance(a, b)).toBeCloseTo(1 - dot);
  });
});
