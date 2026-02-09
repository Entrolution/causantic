/**
 * Tests for UnionFind data structure.
 */

import { describe, it, expect } from 'vitest';
import { UnionFind } from '../../../src/clusters/hdbscan/union-find.js';

describe('UnionFind', () => {
  describe('initialization', () => {
    it('starts with n disjoint components', () => {
      const uf = new UnionFind(5);

      expect(uf.getNumComponents()).toBe(5);

      for (let i = 0; i < 5; i++) {
        expect(uf.find(i)).toBe(i);
        expect(uf.getSize(i)).toBe(1);
      }
    });

    it('handles single element', () => {
      const uf = new UnionFind(1);

      expect(uf.getNumComponents()).toBe(1);
      expect(uf.find(0)).toBe(0);
      expect(uf.getSize(0)).toBe(1);
    });

    it('handles empty', () => {
      const uf = new UnionFind(0);
      expect(uf.getNumComponents()).toBe(0);
    });
  });

  describe('union and find', () => {
    it('unions elements correctly', () => {
      const uf = new UnionFind(5);

      uf.union(0, 1);
      expect(uf.connected(0, 1)).toBe(true);
      expect(uf.getNumComponents()).toBe(4);
      expect(uf.getSize(0)).toBe(2);
      expect(uf.getSize(1)).toBe(2);

      uf.union(2, 3);
      expect(uf.connected(2, 3)).toBe(true);
      expect(uf.connected(0, 2)).toBe(false);
      expect(uf.getNumComponents()).toBe(3);

      uf.union(1, 3);
      expect(uf.connected(0, 2)).toBe(true);
      expect(uf.connected(0, 3)).toBe(true);
      expect(uf.getNumComponents()).toBe(2);
      expect(uf.getSize(0)).toBe(4);
    });

    it('union of already connected elements does nothing', () => {
      const uf = new UnionFind(3);

      uf.union(0, 1);
      expect(uf.getNumComponents()).toBe(2);

      const result = uf.union(0, 1);
      expect(result).toBe(-1);
      expect(uf.getNumComponents()).toBe(2);
    });

    it('find with path compression', () => {
      const uf = new UnionFind(5);

      // Create a chain: 4 -> 3 -> 2 -> 1 -> 0
      uf.union(0, 1);
      uf.union(1, 2);
      uf.union(2, 3);
      uf.union(3, 4);

      // After find, all should point directly to root
      const root = uf.find(4);
      expect(uf.find(0)).toBe(root);
      expect(uf.find(1)).toBe(root);
      expect(uf.find(2)).toBe(root);
      expect(uf.find(3)).toBe(root);
    });
  });

  describe('getComponents', () => {
    it('returns all components', () => {
      const uf = new UnionFind(6);

      uf.union(0, 1);
      uf.union(2, 3);
      uf.union(3, 4);

      const components = uf.getComponents();

      expect(components.size).toBe(3);

      // Component with 0, 1
      const comp1 = components.get(uf.find(0));
      expect(comp1).toContain(0);
      expect(comp1).toContain(1);
      expect(comp1?.length).toBe(2);

      // Component with 2, 3, 4
      const comp2 = components.get(uf.find(2));
      expect(comp2).toContain(2);
      expect(comp2).toContain(3);
      expect(comp2).toContain(4);
      expect(comp2?.length).toBe(3);

      // Component with just 5
      const comp3 = components.get(uf.find(5));
      expect(comp3).toContain(5);
      expect(comp3?.length).toBe(1);
    });
  });

  describe('getComponentMembers', () => {
    it('returns all members of a component', () => {
      const uf = new UnionFind(5);

      uf.union(0, 1);
      uf.union(1, 2);

      const members = uf.getComponentMembers(1);
      expect(members).toContain(0);
      expect(members).toContain(1);
      expect(members).toContain(2);
      expect(members.length).toBe(3);
    });
  });

  describe('connected', () => {
    it('returns true for connected elements', () => {
      const uf = new UnionFind(4);

      uf.union(0, 1);
      uf.union(2, 3);

      expect(uf.connected(0, 1)).toBe(true);
      expect(uf.connected(2, 3)).toBe(true);
      expect(uf.connected(0, 2)).toBe(false);
      expect(uf.connected(1, 3)).toBe(false);
    });

    it('element is connected to itself', () => {
      const uf = new UnionFind(3);
      expect(uf.connected(0, 0)).toBe(true);
      expect(uf.connected(1, 1)).toBe(true);
    });
  });

  describe('large scale', () => {
    it('handles 1000 elements efficiently', () => {
      const uf = new UnionFind(1000);

      // Union all even numbers
      for (let i = 0; i < 998; i += 2) {
        uf.union(i, i + 2);
      }

      // Union all odd numbers
      for (let i = 1; i < 999; i += 2) {
        uf.union(i, i + 2);
      }

      expect(uf.getNumComponents()).toBe(2);
      expect(uf.getSize(0)).toBe(500);
      expect(uf.getSize(1)).toBe(500);
      expect(uf.connected(0, 998)).toBe(true);
      expect(uf.connected(1, 999)).toBe(true);
      expect(uf.connected(0, 1)).toBe(false);
    });
  });
});
