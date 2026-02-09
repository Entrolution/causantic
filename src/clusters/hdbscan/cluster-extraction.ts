/**
 * Cluster extraction from condensed tree.
 * Supports EOM (Excess of Mass) and Leaf methods.
 */

import type { CondensedTree, CondensedTreeNode } from './types.js';

/**
 * Extract clusters using the specified method.
 *
 * @param tree Condensed cluster tree.
 * @param method Selection method: 'eom' (default) or 'leaf'.
 * @returns Array of selected cluster IDs.
 */
export function extractClusters(
  tree: CondensedTree,
  method: 'eom' | 'leaf' = 'eom'
): number[] {
  if (tree.nodes.size === 0 || tree.root === -1) {
    return [];
  }

  // Get all cluster nodes (id >= numPoints)
  const clusterNodes: CondensedTreeNode[] = [];
  for (const [id, node] of tree.nodes) {
    if (node.isCluster && id >= tree.numPoints) {
      clusterNodes.push(node);
    }
  }

  if (clusterNodes.length === 0) {
    return [];
  }

  // Compute stability for all cluster nodes
  computeStability(tree, clusterNodes);

  if (method === 'leaf') {
    return extractLeafClusters(clusterNodes);
  }

  return extractEOMClusters(tree, clusterNodes);
}

/**
 * Compute stability for cluster nodes.
 * Stability = sum over member points: (point_lambda_death - cluster_lambda_birth)
 *
 * For a cluster to have positive stability, points must "live" within it
 * (join at lambdaBirth or later, persist until the cluster dies)
 */
function computeStability(tree: CondensedTree, clusters: CondensedTreeNode[]): void {
  // First, for each leaf cluster, find its directly associated points
  // A point belongs to a leaf cluster if its lambdaDeath equals the cluster's lambdaBirth

  // Then for parent clusters, accumulate stability from children plus
  // any points that joined directly (not via children)

  // Build a map from cluster to its member points
  const clusterToPoints = new Map<number, Set<number>>();

  for (const cluster of clusters) {
    clusterToPoints.set(cluster.id, new Set());
  }

  // Assign each point to the deepest cluster it belongs to
  // A point belongs to a cluster if its lambdaDeath is at or below the cluster's lambdaBirth
  for (let i = 0; i < tree.numPoints; i++) {
    const pointNode = tree.nodes.get(i);
    if (!pointNode) continue;

    const pointLambda = pointNode.lambdaDeath;
    if (pointLambda <= 0 || !isFinite(pointLambda)) continue;

    // Find the cluster(s) this point belongs to
    // It belongs to a cluster if it joined (lambdaDeath) at or after cluster's lambdaBirth
    for (const cluster of clusters) {
      // Point joined this cluster if it was born at this cluster's birth
      // (i.e., the cluster formed from a component containing this point)
      if (Math.abs(pointLambda - cluster.lambdaBirth) < 1e-10) {
        clusterToPoints.get(cluster.id)!.add(i);
      }
    }
  }

  // Compute stability for each cluster
  for (const cluster of clusters) {
    const points = clusterToPoints.get(cluster.id)!;
    let stability = 0;

    for (const pointId of points) {
      const pointNode = tree.nodes.get(pointId)!;
      // Stability contribution = lambda_death - lambda_birth of cluster
      // But for these points, lambda_death === cluster.lambdaBirth
      // So we need to think about this differently

      // Actually, stability is about how long a point persists in a cluster
      // A point joins at lambda = cluster.lambdaBirth
      // It leaves when the cluster dies at cluster.lambdaDeath
      // But we store point's lambdaDeath as when it joined a cluster

      // The correct formula is:
      // For each point in cluster: (min(lambdaDeath_cluster, lambda_point_left) - lambdaBirth_cluster) * 1
      // Since we're dealing with lambdas (1/distance), higher lambda means closer/denser

      // Let's use: stability = sum of (point's persistence in this cluster)
      // A point persists from lambdaBirth to lambdaDeath of cluster (or until it left)

      const clusterDeath = isFinite(cluster.lambdaDeath) ? cluster.lambdaDeath : 0;
      const persistence = cluster.lambdaBirth - clusterDeath;
      if (persistence > 0) {
        stability += persistence;
      }
    }

    cluster.stability = stability;
  }

  // For non-leaf clusters, we might need to add stability from points that
  // joined after children merged but before the cluster died
  // This is handled above since we check all points against all clusters
}

/**
 * Extract clusters using Excess of Mass (EOM) method.
 * Bottom-up selection: compare node stability vs children total.
 */
function extractEOMClusters(tree: CondensedTree, clusters: CondensedTreeNode[]): number[] {
  // Sort by lambdaBirth descending (process children before parents)
  const sorted = [...clusters].sort((a, b) => b.lambdaBirth - a.lambdaBirth);

  // Track subtree stability (sum of selected children OR own stability)
  const subtreeStability = new Map<number, number>();

  for (const cluster of sorted) {
    if (cluster.children.length === 0) {
      // Leaf cluster: select it
      subtreeStability.set(cluster.id, cluster.stability);
      cluster.selected = true;
    } else {
      // Non-leaf: compare own stability vs children's subtree stability
      let childrenTotal = 0;
      for (const childId of cluster.children) {
        const childStability = subtreeStability.get(childId) ?? 0;
        childrenTotal += childStability;
      }

      if (cluster.stability >= childrenTotal) {
        // This cluster is more stable - select it, deselect children
        subtreeStability.set(cluster.id, cluster.stability);
        cluster.selected = true;

        for (const childId of cluster.children) {
          const child = tree.nodes.get(childId);
          if (child) child.selected = false;
        }
      } else {
        // Children are more stable - keep them selected
        subtreeStability.set(cluster.id, childrenTotal);
        cluster.selected = false;
      }
    }
  }

  return clusters.filter((c) => c.selected).map((c) => c.id);
}

/**
 * Extract clusters using Leaf method.
 * Select only leaf nodes (finest granularity).
 */
function extractLeafClusters(clusters: CondensedTreeNode[]): number[] {
  const leaves: number[] = [];

  for (const cluster of clusters) {
    if (cluster.children.length === 0) {
      leaves.push(cluster.id);
      cluster.selected = true;
    } else {
      cluster.selected = false;
    }
  }

  return leaves;
}

/**
 * Assign labels to points based on selected clusters.
 *
 * @param tree Condensed cluster tree.
 * @param selectedClusters Selected cluster IDs.
 * @returns Labels for each point (-1 = noise).
 */
export function assignLabels(
  tree: CondensedTree,
  selectedClusters: number[]
): number[] {
  const labels = new Array<number>(tree.numPoints).fill(-1);

  if (selectedClusters.length === 0) {
    return labels;
  }

  // For each selected cluster, find all points that belong to it
  for (let clusterLabel = 0; clusterLabel < selectedClusters.length; clusterLabel++) {
    const clusterId = selectedClusters[clusterLabel];
    const clusterNode = tree.nodes.get(clusterId);
    if (!clusterNode) continue;

    // Find all points in this cluster (recursively through children)
    const points = getAllClusterPoints(tree, clusterId);

    for (const pointId of points) {
      if (labels[pointId] === -1) {
        labels[pointId] = clusterLabel;
      }
    }
  }

  return labels;
}

/**
 * Get all points that belong to a cluster (including via children).
 */
function getAllClusterPoints(tree: CondensedTree, clusterId: number): number[] {
  const points: number[] = [];
  const clusterNode = tree.nodes.get(clusterId);
  if (!clusterNode || !clusterNode.isCluster) {
    return points;
  }

  // Find all points with lambdaDeath matching this cluster or any ancestor
  const clusterLambda = clusterNode.lambdaBirth;

  for (let i = 0; i < tree.numPoints; i++) {
    const pointNode = tree.nodes.get(i);
    if (!pointNode) continue;

    // Point belongs to this cluster if:
    // 1. Its lambdaDeath >= cluster's lambdaBirth (joined at or after cluster formed)
    // 2. Its lambdaDeath <= cluster's lambdaDeath (left at or before cluster died)
    const clusterDeath = clusterNode.lambdaDeath;
    const pointLambda = pointNode.lambdaDeath;

    if (pointLambda >= clusterDeath && pointLambda <= clusterLambda + 1e-10) {
      points.push(i);
    }
  }

  // Also recurse into children
  for (const childId of clusterNode.children) {
    const childPoints = getAllClusterPoints(tree, childId);
    for (const p of childPoints) {
      if (!points.includes(p)) {
        points.push(p);
      }
    }
  }

  return points;
}

/**
 * Get cluster stability scores.
 */
export function getClusterStabilities(
  tree: CondensedTree
): Map<number, number> {
  const stabilities = new Map<number, number>();

  for (const [id, node] of tree.nodes) {
    if (node.isCluster && id >= tree.numPoints) {
      stabilities.set(id, node.stability);
    }
  }

  return stabilities;
}
