import { describe, it, expect } from 'vitest';
import { quickselect, quickselectInPlace, partition, swap } from '../../src/utils/array-utils.js';

describe('array-utils', () => {
  describe('swap', () => {
    it('swaps two elements', () => {
      const arr = [1, 2, 3];
      swap(arr, 0, 2);
      expect(arr).toEqual([3, 2, 1]);
    });

    it('swaps same index (no-op)', () => {
      const arr = [1, 2, 3];
      swap(arr, 1, 1);
      expect(arr).toEqual([1, 2, 3]);
    });
  });

  describe('partition', () => {
    it('partitions array around pivot', () => {
      const arr = [3, 1, 4, 1, 5, 9, 2, 6];
      const pivotIndex = partition(arr, 0, arr.length - 1, 0);

      // All elements before pivotIndex should be < arr[pivotIndex]
      for (let i = 0; i < pivotIndex; i++) {
        expect(arr[i]).toBeLessThan(arr[pivotIndex]);
      }
      // All elements after pivotIndex should be >= arr[pivotIndex]
      for (let i = pivotIndex + 1; i < arr.length; i++) {
        expect(arr[i]).toBeGreaterThanOrEqual(arr[pivotIndex]);
      }
    });
  });

  describe('quickselectInPlace', () => {
    it('finds k-th smallest element', () => {
      const arr = [7, 3, 1, 5, 9];
      const result = quickselectInPlace(arr, 0, arr.length - 1, 2);
      expect(result).toBe(5); // sorted: [1, 3, 5, 7, 9] → index 2 = 5
    });

    it('returns element when left equals right', () => {
      const arr = [42];
      expect(quickselectInPlace(arr, 0, 0, 0)).toBe(42);
    });
  });

  describe('quickselect', () => {
    it('returns 0 for empty array', () => {
      expect(quickselect([], 0)).toBe(0);
    });

    it('returns single element', () => {
      expect(quickselect([42], 0)).toBe(42);
    });

    it('finds minimum (k=0)', () => {
      expect(quickselect([5, 3, 1, 4, 2], 0)).toBe(1);
    });

    it('finds maximum (k=n-1)', () => {
      expect(quickselect([5, 3, 1, 4, 2], 4)).toBe(5);
    });

    it('finds median', () => {
      expect(quickselect([5, 3, 1, 4, 2], 2)).toBe(3);
    });

    it('clamps k to array length - 1', () => {
      expect(quickselect([5, 3, 1], 10)).toBe(5);
    });

    it('does not modify original array', () => {
      const original = [5, 3, 1, 4, 2];
      const copy = [...original];
      quickselect(original, 2);
      expect(original).toEqual(copy);
    });

    it('handles duplicate values', () => {
      expect(quickselect([3, 3, 3, 1, 1], 2)).toBe(3);
    });

    it('handles already sorted array', () => {
      expect(quickselect([1, 2, 3, 4, 5], 3)).toBe(4);
    });

    it('handles reverse sorted array', () => {
      expect(quickselect([5, 4, 3, 2, 1], 1)).toBe(2);
    });

    it('handles two elements', () => {
      expect(quickselect([2, 1], 0)).toBe(1);
      expect(quickselect([2, 1], 1)).toBe(2);
    });

    it('handles floating point values', () => {
      const result = quickselect([0.5, 0.1, 0.9, 0.3], 1);
      expect(result).toBeCloseTo(0.3);
    });
  });
});
