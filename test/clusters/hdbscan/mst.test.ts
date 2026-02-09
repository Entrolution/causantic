/**
 * Tests for MST construction.
 */

import { describe, it, expect } from 'vitest';
import { buildMST, mutualReachabilityDistance } from '../../../src/clusters/hdbscan/mst.js';

describe('buildMST', () => {
  describe('basic structure', () => {
    it('returns empty for empty input', () => {
      const edges = buildMST([], []);
      expect(edges).toEqual([]);
    });

    it('returns empty for single point', () => {
      const edges = buildMST([[0, 0]], [0]);
      expect(edges).toEqual([]);
    });

    it('produces n-1 edges for n points', () => {
      const points = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ];
      const coreDistances = [1, 1, 1, 1];

      const edges = buildMST(points, coreDistances);

      expect(edges.length).toBe(3);
    });

    it('edges are sorted by weight ascending', () => {
      const points = [
        [0, 0],
        [1, 0],
        [5, 0],
        [10, 0],
      ];
      const coreDistances = [1, 1, 1, 1];

      const edges = buildMST(points, coreDistances);

      for (let i = 1; i < edges.length; i++) {
        expect(edges[i].weight).toBeGreaterThanOrEqual(edges[i - 1].weight);
      }
    });
  });

  describe('mutual reachability', () => {
    it('uses mutual reachability distance', () => {
      const points = [
        [0, 0],
        [1, 0],
        [10, 0],
      ];
      // Point 2 has high core distance
      const coreDistances = [1, 1, 9];

      const edges = buildMST(points, coreDistances);

      // Edge to point 2: MRD = max(coreDistA, coreDistB, dist)
      // If connecting 1 to 2: max(1, 9, 9) = 9
      const edgeToPoint2 = edges.find((e) => e.from === 2 || e.to === 2);
      expect(edgeToPoint2?.weight).toBe(9);
    });
  });

  describe('connectivity', () => {
    it('connects all points', () => {
      const points = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ];
      const coreDistances = [0.5, 0.5, 0.5, 0.5];

      const edges = buildMST(points, coreDistances);

      // Track connected components
      const visited = new Set<number>();
      const toVisit = [0];

      while (toVisit.length > 0) {
        const v = toVisit.pop()!;
        if (visited.has(v)) continue;
        visited.add(v);

        for (const edge of edges) {
          if (edge.from === v && !visited.has(edge.to)) {
            toVisit.push(edge.to);
          }
          if (edge.to === v && !visited.has(edge.from)) {
            toVisit.push(edge.from);
          }
        }
      }

      expect(visited.size).toBe(4);
    });
  });

  describe('minimum weight', () => {
    it('produces minimum spanning tree', () => {
      // 4 points in a square
      const points = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const coreDistances = [0.5, 0.5, 0.5, 0.5];

      const edges = buildMST(points, coreDistances);

      // Total weight should be minimum possible (3 edges of length 1)
      const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);

      // With these core distances, MRD for adjacent edges is 1
      // MST should use 3 adjacent edges, not the diagonal
      expect(totalWeight).toBeCloseTo(3);
    });
  });

  describe('with angular metric', () => {
    it('builds MST with angular distance', () => {
      const points = [
        [1, 0],
        [0.707, 0.707],
        [0, 1],
      ];
      const coreDistances = [0.1, 0.1, 0.1];

      const edges = buildMST(points, coreDistances, 'angular');

      expect(edges.length).toBe(2);

      // First edge should be smaller weight
      expect(edges[0].weight).toBeLessThanOrEqual(edges[1].weight);
    });
  });
});

describe('mutualReachabilityDistance', () => {
  it('uses max of core distances and actual distance', () => {
    const a = [0, 0];
    const b = [3, 4]; // Distance = 5

    // MRD = max(2, 3, 5) = 5
    expect(mutualReachabilityDistance(a, b, 2, 3)).toBe(5);

    // MRD = max(10, 3, 5) = 10
    expect(mutualReachabilityDistance(a, b, 10, 3)).toBe(10);

    // MRD = max(2, 10, 5) = 10
    expect(mutualReachabilityDistance(a, b, 2, 10)).toBe(10);
  });

  it('works with angular metric', () => {
    const a = [1, 0];
    const b = [0, 1]; // Angular distance = 1

    const mrd = mutualReachabilityDistance(a, b, 0.5, 0.5, 'angular');
    expect(mrd).toBe(1);
  });
});
