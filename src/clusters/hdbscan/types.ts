/**
 * Type definitions for native HDBSCAN implementation.
 */

/**
 * Options for HDBSCAN clustering.
 */
export interface HDBSCANOptions {
  /** Minimum cluster size. Clusters smaller than this are considered noise. */
  minClusterSize: number;
  /** Minimum samples for core point. Defaults to minClusterSize. */
  minSamples?: number;
  /** Distance metric. Default: 'euclidean'. */
  metric?: 'euclidean' | 'angular';
  /** Cluster selection method. Default: 'eom' (Excess of Mass). */
  clusterSelectionMethod?: 'eom' | 'leaf';
  /** Use KD-tree for approximate k-NN. Default: false. */
  approximateKNN?: boolean;
  /** Use worker_threads for parallel core distance. Default: true. */
  parallel?: boolean;
}

/**
 * Full result from HDBSCAN clustering.
 */
export interface HDBSCANResult {
  /** Cluster labels. -1 = noise, 0+ = cluster ID. */
  labels: number[];
  /** Membership probability (0.0-1.0) for each point. */
  probabilities: number[];
  /** Outlier scores (0.0-1.0) for each point. Higher = more outlier-ish. */
  outlierScores: number[];
  /** Number of clusters found. */
  numClusters: number;
  /** Number of noise points. */
  noiseCount: number;
}

/**
 * Model state for persistence and incremental assignment.
 */
export interface HDBSCANModel {
  /** Original embeddings used for fitting. */
  embeddings: number[][];
  /** Core distances for each point. */
  coreDistances: number[];
  /** Cluster labels. */
  labels: number[];
  /** Cluster centroids for incremental assignment. */
  centroids: Map<number, number[]>;
  /** Exemplar indices per cluster (closest to centroid). */
  exemplars: Map<number, number[]>;
  /** Lambda values for probability computation. */
  lambdaValues: number[];
  /** Maximum lambda per cluster. */
  clusterMaxLambda: Map<number, number>;
}

/**
 * MST edge representation.
 */
export interface MSTEdge {
  /** Source point index. */
  from: number;
  /** Destination point index. */
  to: number;
  /** Mutual reachability distance. */
  weight: number;
}

/**
 * Node in condensed cluster tree.
 */
export interface CondensedTreeNode {
  /** Node ID (cluster or point). */
  id: number;
  /** Parent node ID. */
  parent: number;
  /** Lambda value (1/distance) when this node was created. */
  lambdaBirth: number;
  /** Lambda value when this node died (merged or became noise). */
  lambdaDeath: number;
  /** Number of points in this node. */
  size: number;
  /** Whether this is a cluster (vs single point). */
  isCluster: boolean;
  /** Child nodes. */
  children: number[];
  /** Stability score for cluster selection. */
  stability: number;
  /** Whether this cluster is selected in final result. */
  selected: boolean;
}

/**
 * Condensed cluster tree.
 */
export interface CondensedTree {
  /** All nodes indexed by ID. */
  nodes: Map<number, CondensedTreeNode>;
  /** Root node ID. */
  root: number;
  /** Number of original data points. */
  numPoints: number;
}

/**
 * Worker message for parallel core distance computation.
 */
export interface CoreDistanceWorkerData {
  /** Indices to process in this chunk. */
  indices: number[];
  /** All points (for distance computation). */
  allPoints: number[][];
  /** k value for k-th nearest neighbor. */
  k: number;
  /** Distance metric. */
  metric: 'euclidean' | 'angular';
}

/**
 * Worker result for parallel core distance computation.
 */
export interface CoreDistanceWorkerResult {
  /** Core distances for processed indices. */
  coreDistances: Array<{ index: number; coreDistance: number }>;
}
