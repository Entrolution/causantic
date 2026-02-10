/**
 * Shared array utility functions.
 * Quickselect algorithm for finding k-th smallest element.
 */

/**
 * Quickselect algorithm to find k-th smallest element.
 * Average O(n), worst case O(n^2).
 *
 * Makes a copy of the array to avoid modifying the original.
 *
 * @param arr - Input array
 * @param k - Zero-based index of the desired element
 * @returns The k-th smallest element
 */
export function quickselect(arr: number[], k: number): number {
  if (arr.length === 0) return 0;
  if (k >= arr.length) k = arr.length - 1;

  const copy = arr.slice();
  return quickselectInPlace(copy, 0, copy.length - 1, k);
}

/**
 * In-place quickselect using median-of-three pivot selection.
 */
export function quickselectInPlace(arr: number[], left: number, right: number, k: number): number {
  if (left === right) return arr[left];

  const mid = Math.floor((left + right) / 2);
  if (arr[mid] < arr[left]) swap(arr, left, mid);
  if (arr[right] < arr[left]) swap(arr, left, right);
  if (arr[right] < arr[mid]) swap(arr, mid, right);

  const pivotIndex = partition(arr, left, right, mid);

  if (k === pivotIndex) return arr[k];
  if (k < pivotIndex) return quickselectInPlace(arr, left, pivotIndex - 1, k);
  return quickselectInPlace(arr, pivotIndex + 1, right, k);
}

/**
 * Partition array around pivot value.
 */
export function partition(arr: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = arr[pivotIndex];
  swap(arr, pivotIndex, right);
  let storeIndex = left;

  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      swap(arr, i, storeIndex);
      storeIndex++;
    }
  }

  swap(arr, storeIndex, right);
  return storeIndex;
}

/**
 * Swap two elements in an array.
 */
export function swap(arr: number[], i: number, j: number): void {
  const temp = arr[i];
  arr[i] = arr[j];
  arr[j] = temp;
}
