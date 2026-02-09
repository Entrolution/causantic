/**
 * KD-tree for approximate k-nearest neighbor search.
 * Performance degrades in high dimensions but still provides speedup for k-NN.
 */

interface KDNode {
  point: number[];
  index: number;
  left: KDNode | null;
  right: KDNode | null;
  splitDim: number;
}

interface NearestNeighbor {
  index: number;
  distance: number;
}

/**
 * KD-tree for efficient k-nearest neighbor search.
 * In high dimensions (>30), performance degrades but still faster than brute force.
 */
export class KDTree {
  private root: KDNode | null = null;
  private dimensions: number = 0;

  /**
   * Build a KD-tree from points.
   * @param points Array of points (each point is a number array).
   */
  constructor(points: number[][]) {
    if (points.length === 0) {
      return;
    }

    this.dimensions = points[0].length;
    const indexedPoints = points.map((p, i) => ({ point: p, index: i }));
    this.root = this.buildTree(indexedPoints, 0);
  }

  /**
   * Build tree recursively.
   */
  private buildTree(
    points: Array<{ point: number[]; index: number }>,
    depth: number
  ): KDNode | null {
    if (points.length === 0) {
      return null;
    }

    const dim = depth % this.dimensions;

    // Sort by splitting dimension
    points.sort((a, b) => a.point[dim] - b.point[dim]);

    const mid = Math.floor(points.length / 2);
    const node: KDNode = {
      point: points[mid].point,
      index: points[mid].index,
      splitDim: dim,
      left: this.buildTree(points.slice(0, mid), depth + 1),
      right: this.buildTree(points.slice(mid + 1), depth + 1),
    };

    return node;
  }

  /**
   * Find k nearest neighbors to a query point.
   * @param query Query point.
   * @param k Number of neighbors to find.
   * @param excludeIndex Optional index to exclude (for self-queries).
   */
  kNearest(query: number[], k: number, excludeIndex?: number): NearestNeighbor[] {
    const neighbors: NearestNeighbor[] = [];
    let maxDist = Infinity;

    const search = (node: KDNode | null): void => {
      if (node === null) {
        return;
      }

      // Compute distance to this node
      if (node.index !== excludeIndex) {
        const dist = this.euclideanDistance(query, node.point);

        if (neighbors.length < k) {
          neighbors.push({ index: node.index, distance: dist });
          neighbors.sort((a, b) => b.distance - a.distance); // Max at front
          if (neighbors.length === k) {
            maxDist = neighbors[0].distance;
          }
        } else if (dist < maxDist) {
          neighbors[0] = { index: node.index, distance: dist };
          neighbors.sort((a, b) => b.distance - a.distance);
          maxDist = neighbors[0].distance;
        }
      }

      // Determine which side to search first
      const dim = node.splitDim;
      const diff = query[dim] - node.point[dim];
      const first = diff < 0 ? node.left : node.right;
      const second = diff < 0 ? node.right : node.left;

      // Search the closer side first
      search(first);

      // Only search the other side if it could contain closer points
      if (neighbors.length < k || Math.abs(diff) < maxDist) {
        search(second);
      }
    };

    search(this.root);

    // Return in ascending distance order
    return neighbors.reverse();
  }

  /**
   * Find the nearest neighbor to a query point.
   */
  nearest(query: number[], excludeIndex?: number): NearestNeighbor | null {
    const neighbors = this.kNearest(query, 1, excludeIndex);
    return neighbors.length > 0 ? neighbors[0] : null;
  }

  /**
   * Compute Euclidean distance between two points.
   */
  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
}

/**
 * Compute Euclidean distance between two points.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compute angular distance between two normalized vectors.
 * Angular distance = 1 - cos(angle) = 1 - dot(a, b)
 */
export function angularDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}
