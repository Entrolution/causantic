/**
 * MinHeap (priority queue) for Prim's MST algorithm.
 * Supports decreaseKey operation for efficient graph algorithms.
 */

export interface HeapEntry<T> {
  key: number;
  value: T;
}

/**
 * Binary min-heap with decreaseKey support.
 * Used for efficient minimum spanning tree construction.
 */
export class MinHeap<T> {
  private heap: HeapEntry<T>[] = [];
  private indexMap: Map<T, number> = new Map();

  /**
   * Number of elements in the heap.
   */
  get size(): number {
    return this.heap.length;
  }

  /**
   * Whether the heap is empty.
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Insert a new element.
   */
  insert(key: number, value: T): void {
    const entry: HeapEntry<T> = { key, value };
    this.heap.push(entry);
    const index = this.heap.length - 1;
    this.indexMap.set(value, index);
    this.bubbleUp(index);
  }

  /**
   * Get the minimum element without removing it.
   */
  peek(): HeapEntry<T> | undefined {
    return this.heap[0];
  }

  /**
   * Extract the minimum element.
   */
  extractMin(): HeapEntry<T> | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const min = this.heap[0];
    this.indexMap.delete(min.value);

    if (this.heap.length === 1) {
      this.heap.pop();
      return min;
    }

    // Move last element to root and bubble down
    const last = this.heap.pop()!;
    this.heap[0] = last;
    this.indexMap.set(last.value, 0);
    this.bubbleDown(0);

    return min;
  }

  /**
   * Decrease the key of an existing element.
   * Returns true if the key was decreased, false if element not found.
   */
  decreaseKey(value: T, newKey: number): boolean {
    const index = this.indexMap.get(value);
    if (index === undefined) {
      return false;
    }

    if (newKey >= this.heap[index].key) {
      // New key is not smaller, no change needed
      return false;
    }

    this.heap[index].key = newKey;
    this.bubbleUp(index);
    return true;
  }

  /**
   * Check if a value is in the heap.
   */
  has(value: T): boolean {
    return this.indexMap.has(value);
  }

  /**
   * Get the current key for a value.
   */
  getKey(value: T): number | undefined {
    const index = this.indexMap.get(value);
    if (index === undefined) {
      return undefined;
    }
    return this.heap[index].key;
  }

  /**
   * Bubble up element at index to restore heap property.
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].key <= this.heap[index].key) {
        break;
      }
      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  /**
   * Bubble down element at index to restore heap property.
   */
  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.heap[leftChild].key < this.heap[smallest].key) {
        smallest = leftChild;
      }
      if (rightChild < length && this.heap[rightChild].key < this.heap[smallest].key) {
        smallest = rightChild;
      }

      if (smallest === index) {
        break;
      }

      this.swap(index, smallest);
      index = smallest;
    }
  }

  /**
   * Swap two elements and update index map.
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
    this.indexMap.set(this.heap[i].value, i);
    this.indexMap.set(this.heap[j].value, j);
  }
}
