/**
 * Union-Find (Disjoint Set) with path compression and union by rank.
 * Used for efficient component tracking during MST processing.
 */

/**
 * Union-Find data structure with path compression and union by rank.
 * Provides near-constant time operations for union and find.
 */
export class UnionFind {
  private parent: number[];
  private rank: number[];
  private componentSize: number[];
  private numComponents: number;

  /**
   * Create a new Union-Find structure.
   * @param n Number of elements (0 to n-1).
   */
  constructor(n: number) {
    this.parent = new Array(n);
    this.rank = new Array(n);
    this.componentSize = new Array(n);
    this.numComponents = n;

    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
      this.componentSize[i] = 1;
    }
  }

  /**
   * Find the root of the set containing element x.
   * Uses path compression for efficiency.
   */
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }

  /**
   * Union the sets containing elements x and y.
   * Uses union by rank for balanced trees.
   * Returns the root of the merged set, or -1 if already in same set.
   */
  union(x: number, y: number): number {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) {
      return -1; // Already in same set
    }

    this.numComponents--;

    // Union by rank
    if (this.rank[rootX] < this.rank[rootY]) {
      this.parent[rootX] = rootY;
      this.componentSize[rootY] += this.componentSize[rootX];
      return rootY;
    } else if (this.rank[rootX] > this.rank[rootY]) {
      this.parent[rootY] = rootX;
      this.componentSize[rootX] += this.componentSize[rootY];
      return rootX;
    } else {
      this.parent[rootY] = rootX;
      this.componentSize[rootX] += this.componentSize[rootY];
      this.rank[rootX]++;
      return rootX;
    }
  }

  /**
   * Check if two elements are in the same set.
   */
  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }

  /**
   * Get the size of the component containing element x.
   */
  getSize(x: number): number {
    return this.componentSize[this.find(x)];
  }

  /**
   * Get the number of disjoint components.
   */
  getNumComponents(): number {
    return this.numComponents;
  }

  /**
   * Get all components as a map from root to member indices.
   */
  getComponents(): Map<number, number[]> {
    const components = new Map<number, number[]>();

    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(i);
    }

    return components;
  }

  /**
   * Get all elements in the component containing x.
   */
  getComponentMembers(x: number): number[] {
    const root = this.find(x);
    const members: number[] = [];

    for (let i = 0; i < this.parent.length; i++) {
      if (this.find(i) === root) {
        members.push(i);
      }
    }

    return members;
  }
}
