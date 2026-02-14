/**
 * Condensed cluster tree construction for HDBSCAN.
 *
 * The algorithm works as follows:
 * 1. Start with each point in its own component
 * 2. Process MST edges in ascending weight (lowest distance first)
 * 3. Merge components as edges connect them
 * 4. When a component reaches minClusterSize, it becomes a cluster
 * 5. Track cluster splits as larger structures merge
 */

import { UnionFind } from './union-find.js';
import type { MSTEdge, CondensedTree, CondensedTreeNode } from './types.js';

/**
 * Extended node with point membership tracking.
 */
interface ClusterNodeWithPoints extends CondensedTreeNode {
  memberPoints: Set<number>;
}

/**
 * Build a condensed cluster tree from the MST.
 */
export function buildCondensedTree(
  edges: MSTEdge[],
  numPoints: number,
  minClusterSize: number,
): CondensedTree {
  if (numPoints === 0) {
    return { nodes: new Map(), root: -1, numPoints: 0 };
  }

  const nodes = new Map<number, ClusterNodeWithPoints>();

  // Initialize point nodes
  for (let i = 0; i < numPoints; i++) {
    nodes.set(i, {
      id: i,
      parent: -1,
      lambdaBirth: Infinity,
      lambdaDeath: 0,
      size: 1,
      isCluster: false,
      children: [],
      stability: 0,
      selected: false,
      memberPoints: new Set([i]),
    });
  }

  if (edges.length === 0) {
    const root = numPoints;
    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: 0,
      isCluster: true,
      children: [],
      stability: 0,
      selected: false,
      memberPoints: new Set(),
    });
    return { nodes: convertNodes(nodes), root, numPoints };
  }

  // Sort edges ascending by weight
  const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);

  const uf = new UnionFind(numPoints);
  let nextClusterId = numPoints;

  // Track which cluster a component root belongs to
  const rootToCluster = new Map<number, number>(); // component root -> cluster id

  for (const edge of sortedEdges) {
    const lambda = edge.weight > 0 ? 1 / edge.weight : Infinity;
    const rootA = uf.find(edge.from);
    const rootB = uf.find(edge.to);

    if (rootA === rootB) continue;

    const sizeA = uf.getSize(rootA);
    const sizeB = uf.getSize(rootB);
    const combinedSize = sizeA + sizeB;

    const clusterIdA = rootToCluster.get(rootA);
    const clusterIdB = rootToCluster.get(rootB);

    // Merge in union-find
    const newRoot = uf.union(edge.from, edge.to);

    if (clusterIdA !== undefined && clusterIdB !== undefined) {
      // Both were clusters - merge them into a new parent
      const parentClusterId = nextClusterId++;
      const clusterA = nodes.get(clusterIdA)!;
      const clusterB = nodes.get(clusterIdB)!;
      const allPoints = new Set([...clusterA.memberPoints, ...clusterB.memberPoints]);

      nodes.set(parentClusterId, {
        id: parentClusterId,
        parent: -1,
        lambdaBirth: lambda,
        lambdaDeath: Infinity,
        size: combinedSize,
        isCluster: true,
        children: [clusterIdA, clusterIdB],
        stability: 0,
        selected: false,
        memberPoints: allPoints,
      });

      // Update children
      clusterA.parent = parentClusterId;
      clusterA.lambdaDeath = lambda;
      clusterB.parent = parentClusterId;
      clusterB.lambdaDeath = lambda;

      rootToCluster.delete(rootA);
      rootToCluster.delete(rootB);
      rootToCluster.set(newRoot, parentClusterId);
    } else if (clusterIdA !== undefined) {
      // Only A was a cluster - points from B join A
      const clusterA = nodes.get(clusterIdA)!;
      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot && !clusterA.memberPoints.has(i)) {
          nodes.get(i)!.lambdaDeath = lambda;
          clusterA.memberPoints.add(i);
        }
      }
      clusterA.size = combinedSize;
      rootToCluster.delete(rootA);
      rootToCluster.set(newRoot, clusterIdA);
    } else if (clusterIdB !== undefined) {
      // Only B was a cluster - points from A join B
      const clusterB = nodes.get(clusterIdB)!;
      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot && !clusterB.memberPoints.has(i)) {
          nodes.get(i)!.lambdaDeath = lambda;
          clusterB.memberPoints.add(i);
        }
      }
      clusterB.size = combinedSize;
      rootToCluster.delete(rootB);
      rootToCluster.set(newRoot, clusterIdB);
    } else if (combinedSize >= minClusterSize) {
      // Neither was a cluster, but combined is big enough - new cluster born
      const clusterId = nextClusterId++;
      const points = new Set<number>();

      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot) {
          points.add(i);
          nodes.get(i)!.lambdaDeath = lambda;
        }
      }

      nodes.set(clusterId, {
        id: clusterId,
        parent: -1,
        lambdaBirth: lambda,
        lambdaDeath: Infinity,
        size: combinedSize,
        isCluster: true,
        children: [],
        stability: 0,
        selected: false,
        memberPoints: points,
      });

      rootToCluster.set(newRoot, clusterId);
    }
    // else: combined is still too small, just merge tracking
  }

  // Find remaining active clusters
  const activeClusters = [...new Set(rootToCluster.values())];

  let root: number;
  if (activeClusters.length === 0) {
    // No clusters found
    root = nextClusterId++;
    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: 0,
      isCluster: true,
      children: [],
      stability: 0,
      selected: false,
      memberPoints: new Set(),
    });
  } else if (activeClusters.length === 1) {
    root = activeClusters[0];
  } else {
    // Multiple clusters remain - create root
    root = nextClusterId++;
    const allPoints = new Set<number>();
    for (const cid of activeClusters) {
      for (const p of nodes.get(cid)!.memberPoints) {
        allPoints.add(p);
      }
    }

    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: numPoints,
      isCluster: true,
      children: activeClusters,
      stability: 0,
      selected: false,
      memberPoints: allPoints,
    });

    for (const cid of activeClusters) {
      nodes.get(cid)!.parent = root;
      nodes.get(cid)!.lambdaDeath = 0;
    }
  }

  return { nodes: convertNodes(nodes), root, numPoints };
}

/**
 * Convert extended nodes to standard nodes (strip memberPoints).
 */
function convertNodes(nodes: Map<number, ClusterNodeWithPoints>): Map<number, CondensedTreeNode> {
  const result = new Map<number, CondensedTreeNode>();

  for (const [id, node] of nodes) {
    const { memberPoints: _memberPoints, ...rest } = node;
    result.set(id, {
      ...rest,
      // Store memberPoints in a way that can be accessed later
      // We'll use the stability field temporarily, then extract to a separate structure
    });

    // Actually, let's store the member points directly on the node
    // by extending the CondensedTreeNode type or using a side map
  }

  return result;
}

/**
 * Build a condensed cluster tree from the MST, with member point tracking.
 */
export function buildCondensedTreeWithMembers(
  edges: MSTEdge[],
  numPoints: number,
  minClusterSize: number,
): { tree: CondensedTree; memberPoints: Map<number, Set<number>> } {
  if (numPoints === 0) {
    return { tree: { nodes: new Map(), root: -1, numPoints: 0 }, memberPoints: new Map() };
  }

  const nodes = new Map<number, CondensedTreeNode>();
  const memberPoints = new Map<number, Set<number>>();

  // Initialize point nodes
  for (let i = 0; i < numPoints; i++) {
    nodes.set(i, {
      id: i,
      parent: -1,
      lambdaBirth: Infinity,
      lambdaDeath: 0,
      size: 1,
      isCluster: false,
      children: [],
      stability: 0,
      selected: false,
    });
    memberPoints.set(i, new Set([i]));
  }

  if (edges.length === 0) {
    const root = numPoints;
    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: 0,
      isCluster: true,
      children: [],
      stability: 0,
      selected: false,
    });
    memberPoints.set(root, new Set());
    return { tree: { nodes, root, numPoints }, memberPoints };
  }

  // Sort edges ascending by weight
  const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);

  const uf = new UnionFind(numPoints);
  let nextClusterId = numPoints;

  // Track which cluster a component root belongs to
  const rootToCluster = new Map<number, number>(); // component root -> cluster id

  for (const edge of sortedEdges) {
    const lambda = edge.weight > 0 ? 1 / edge.weight : Infinity;
    const rootA = uf.find(edge.from);
    const rootB = uf.find(edge.to);

    if (rootA === rootB) continue;

    const sizeA = uf.getSize(rootA);
    const sizeB = uf.getSize(rootB);
    const combinedSize = sizeA + sizeB;

    const clusterIdA = rootToCluster.get(rootA);
    const clusterIdB = rootToCluster.get(rootB);

    // Merge in union-find
    const newRoot = uf.union(edge.from, edge.to);

    if (clusterIdA !== undefined && clusterIdB !== undefined) {
      // Both were clusters - merge them into a new parent
      const parentClusterId = nextClusterId++;
      const pointsA = memberPoints.get(clusterIdA)!;
      const pointsB = memberPoints.get(clusterIdB)!;
      const allPoints = new Set([...pointsA, ...pointsB]);

      nodes.set(parentClusterId, {
        id: parentClusterId,
        parent: -1,
        lambdaBirth: lambda,
        lambdaDeath: Infinity,
        size: combinedSize,
        isCluster: true,
        children: [clusterIdA, clusterIdB],
        stability: 0,
        selected: false,
      });
      memberPoints.set(parentClusterId, allPoints);

      // Update children
      nodes.get(clusterIdA)!.parent = parentClusterId;
      nodes.get(clusterIdA)!.lambdaDeath = lambda;
      nodes.get(clusterIdB)!.parent = parentClusterId;
      nodes.get(clusterIdB)!.lambdaDeath = lambda;

      rootToCluster.delete(rootA);
      rootToCluster.delete(rootB);
      rootToCluster.set(newRoot, parentClusterId);
    } else if (clusterIdA !== undefined) {
      // Only A was a cluster - points from B join A
      const clusterA = nodes.get(clusterIdA)!;
      const pointsA = memberPoints.get(clusterIdA)!;
      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot && !pointsA.has(i)) {
          nodes.get(i)!.lambdaDeath = lambda;
          pointsA.add(i);
        }
      }
      clusterA.size = combinedSize;
      rootToCluster.delete(rootA);
      rootToCluster.set(newRoot, clusterIdA);
    } else if (clusterIdB !== undefined) {
      // Only B was a cluster - points from A join B
      const clusterB = nodes.get(clusterIdB)!;
      const pointsB = memberPoints.get(clusterIdB)!;
      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot && !pointsB.has(i)) {
          nodes.get(i)!.lambdaDeath = lambda;
          pointsB.add(i);
        }
      }
      clusterB.size = combinedSize;
      rootToCluster.delete(rootB);
      rootToCluster.set(newRoot, clusterIdB);
    } else if (combinedSize >= minClusterSize) {
      // Neither was a cluster, but combined is big enough - new cluster born
      const clusterId = nextClusterId++;
      const points = new Set<number>();

      for (let i = 0; i < numPoints; i++) {
        if (uf.find(i) === newRoot) {
          points.add(i);
          nodes.get(i)!.lambdaDeath = lambda;
        }
      }

      nodes.set(clusterId, {
        id: clusterId,
        parent: -1,
        lambdaBirth: lambda,
        lambdaDeath: Infinity,
        size: combinedSize,
        isCluster: true,
        children: [],
        stability: 0,
        selected: false,
      });
      memberPoints.set(clusterId, points);

      rootToCluster.set(newRoot, clusterId);
    }
    // else: combined is still too small, just merge tracking
  }

  // Find remaining active clusters
  const activeClusters = [...new Set(rootToCluster.values())];

  let root: number;
  if (activeClusters.length === 0) {
    // No clusters found
    root = nextClusterId++;
    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: 0,
      isCluster: true,
      children: [],
      stability: 0,
      selected: false,
    });
    memberPoints.set(root, new Set());
  } else if (activeClusters.length === 1) {
    root = activeClusters[0];
  } else {
    // Multiple clusters remain - create root
    root = nextClusterId++;
    const allPoints = new Set<number>();
    for (const cid of activeClusters) {
      for (const p of memberPoints.get(cid)!) {
        allPoints.add(p);
      }
    }

    nodes.set(root, {
      id: root,
      parent: -1,
      lambdaBirth: 0,
      lambdaDeath: Infinity,
      size: numPoints,
      isCluster: true,
      children: activeClusters,
      stability: 0,
      selected: false,
    });
    memberPoints.set(root, allPoints);

    for (const cid of activeClusters) {
      nodes.get(cid)!.parent = root;
      nodes.get(cid)!.lambdaDeath = 0;
    }
  }

  return { tree: { nodes, root, numPoints }, memberPoints };
}

/**
 * Get all point indices that belong to a cluster.
 */
export function getClusterPoints(tree: CondensedTree, clusterId: number): number[] {
  const points: number[] = [];
  const visited = new Set<number>();

  const collect = (id: number): void => {
    if (visited.has(id)) return;
    visited.add(id);

    if (id < tree.numPoints) {
      points.push(id);
      return;
    }

    const node = tree.nodes.get(id);
    if (!node) return;

    for (const child of node.children) {
      collect(child);
    }
  };

  collect(clusterId);
  return points;
}

/**
 * Get lambda value for a specific point.
 */
export function getPointLambda(
  tree: CondensedTree,
  pointIndex: number,
): { birth: number; death: number } {
  const node = tree.nodes.get(pointIndex);
  if (!node) {
    return { birth: 0, death: 0 };
  }
  return { birth: node.lambdaBirth, death: node.lambdaDeath };
}
