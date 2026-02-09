/**
 * Tests for MinHeap data structure.
 */

import { describe, it, expect } from 'vitest';
import { MinHeap } from '../../../src/clusters/hdbscan/min-heap.js';

describe('MinHeap', () => {
  describe('basic operations', () => {
    it('starts empty', () => {
      const heap = new MinHeap<string>();
      expect(heap.isEmpty()).toBe(true);
      expect(heap.size).toBe(0);
      expect(heap.peek()).toBeUndefined();
    });

    it('inserts and extracts in correct order', () => {
      const heap = new MinHeap<string>();

      heap.insert(5, 'five');
      heap.insert(3, 'three');
      heap.insert(7, 'seven');
      heap.insert(1, 'one');

      expect(heap.size).toBe(4);
      expect(heap.extractMin()?.value).toBe('one');
      expect(heap.extractMin()?.value).toBe('three');
      expect(heap.extractMin()?.value).toBe('five');
      expect(heap.extractMin()?.value).toBe('seven');
      expect(heap.isEmpty()).toBe(true);
    });

    it('peek returns minimum without removing', () => {
      const heap = new MinHeap<number>();

      heap.insert(10, 1);
      heap.insert(5, 2);
      heap.insert(15, 3);

      expect(heap.peek()?.key).toBe(5);
      expect(heap.peek()?.value).toBe(2);
      expect(heap.size).toBe(3);
    });

    it('handles single element', () => {
      const heap = new MinHeap<string>();

      heap.insert(42, 'only');
      expect(heap.size).toBe(1);
      expect(heap.extractMin()?.value).toBe('only');
      expect(heap.isEmpty()).toBe(true);
    });

    it('extracts from empty heap returns undefined', () => {
      const heap = new MinHeap<number>();
      expect(heap.extractMin()).toBeUndefined();
    });
  });

  describe('decreaseKey', () => {
    it('decreases key and reorders', () => {
      const heap = new MinHeap<string>();

      heap.insert(10, 'a');
      heap.insert(20, 'b');
      heap.insert(30, 'c');

      expect(heap.peek()?.value).toBe('a');

      heap.decreaseKey('c', 5);
      expect(heap.peek()?.value).toBe('c');
      expect(heap.extractMin()?.key).toBe(5);
    });

    it('returns false for non-existent value', () => {
      const heap = new MinHeap<string>();
      heap.insert(10, 'a');

      expect(heap.decreaseKey('b', 5)).toBe(false);
    });

    it('returns false if new key is not smaller', () => {
      const heap = new MinHeap<string>();
      heap.insert(10, 'a');

      expect(heap.decreaseKey('a', 15)).toBe(false);
      expect(heap.decreaseKey('a', 10)).toBe(false);
    });

    it('has() checks for presence', () => {
      const heap = new MinHeap<string>();
      heap.insert(10, 'a');

      expect(heap.has('a')).toBe(true);
      expect(heap.has('b')).toBe(false);
    });

    it('getKey() returns current key', () => {
      const heap = new MinHeap<string>();
      heap.insert(10, 'a');
      heap.insert(20, 'b');

      expect(heap.getKey('a')).toBe(10);
      expect(heap.getKey('b')).toBe(20);
      expect(heap.getKey('c')).toBeUndefined();
    });
  });

  describe('large heap', () => {
    it('handles 1000+ elements correctly', () => {
      const heap = new MinHeap<number>();
      const n = 1000;

      // Insert in random order
      const values = Array.from({ length: n }, (_, i) => i);
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }

      for (const v of values) {
        heap.insert(v, v);
      }

      expect(heap.size).toBe(n);

      // Extract should be in order
      for (let i = 0; i < n; i++) {
        const entry = heap.extractMin();
        expect(entry?.key).toBe(i);
        expect(entry?.value).toBe(i);
      }

      expect(heap.isEmpty()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles duplicate keys', () => {
      const heap = new MinHeap<string>();

      heap.insert(5, 'a');
      heap.insert(5, 'b');
      heap.insert(5, 'c');

      expect(heap.size).toBe(3);

      const values = [
        heap.extractMin()?.value,
        heap.extractMin()?.value,
        heap.extractMin()?.value,
      ];

      expect(values).toContain('a');
      expect(values).toContain('b');
      expect(values).toContain('c');
    });

    it('handles negative keys', () => {
      const heap = new MinHeap<string>();

      heap.insert(-5, 'neg5');
      heap.insert(0, 'zero');
      heap.insert(5, 'pos5');

      expect(heap.extractMin()?.value).toBe('neg5');
      expect(heap.extractMin()?.value).toBe('zero');
      expect(heap.extractMin()?.value).toBe('pos5');
    });

    it('handles floating point keys', () => {
      const heap = new MinHeap<number>();

      heap.insert(1.5, 1);
      heap.insert(1.1, 2);
      heap.insert(1.9, 3);

      expect(heap.extractMin()?.value).toBe(2);
      expect(heap.extractMin()?.value).toBe(1);
      expect(heap.extractMin()?.value).toBe(3);
    });
  });
});
