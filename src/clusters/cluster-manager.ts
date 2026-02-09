/**
 * Cluster management: HDBSCAN clustering and chunk assignment.
 */

import { HDBSCAN } from './hdbscan.js';
import { vectorStore } from '../storage/vector-store.js';
import {
  upsertCluster,
  assignChunksToClusters,
  getAllClusters,
  clearAllClusters,
  getClusterChunkIds,
  computeMembershipHash,
} from '../storage/cluster-store.js';
import { getChunksByIds, getAllChunks } from '../storage/chunk-store.js';
import { angularDistance } from '../utils/angular-distance.js';
import { getConfig } from '../config/memory-config.js';
import { generateId } from '../storage/db.js';
import type { StoredCluster, ChunkClusterAssignment } from '../storage/types.js';

/**
 * Result of clustering operation.
 */
export interface ClusteringResult {
  /** Number of clusters created */
  numClusters: number;
  /** Number of chunks assigned to clusters */
  assignedChunks: number;
  /** Number of noise points (unassigned) */
  noiseChunks: number;
  /** Noise ratio */
  noiseRatio: number;
  /** Cluster sizes */
  clusterSizes: number[];
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Options for clustering.
 */
export interface ClusteringOptions {
  /** Minimum cluster size for HDBSCAN. Default: from config. */
  minClusterSize?: number;
  /** Angular distance threshold for assignment. Default: from config. */
  clusterThreshold?: number;
  /** Clear existing clusters before reclustering. Default: true. */
  clearExisting?: boolean;
}

/**
 * Cluster manager for running HDBSCAN and managing cluster assignments.
 */
export class ClusterManager {
  private config = getConfig();

  /**
   * Run HDBSCAN on all chunks and create clusters.
   */
  async recluster(options: ClusteringOptions = {}): Promise<ClusteringResult> {
    const startTime = Date.now();

    const {
      minClusterSize = this.config.minClusterSize,
      clearExisting = true,
    } = options;

    // Clear existing clusters if requested
    if (clearExisting) {
      clearAllClusters();
    }

    // Get all vectors
    const vectors = await vectorStore.getAllVectors();

    if (vectors.length === 0) {
      return {
        numClusters: 0,
        assignedChunks: 0,
        noiseChunks: 0,
        noiseRatio: 0,
        clusterSizes: [],
        durationMs: Date.now() - startTime,
      };
    }

    // Run HDBSCAN
    const embeddings = vectors.map((v) => v.embedding);
    const hdbscan = new HDBSCAN({
      minClusterSize,
      minSamples: minClusterSize,
    });

    const labels = hdbscan.fitSync(embeddings);

    // Group by cluster
    const clusterMembers = new Map<number, Array<{ id: string; embedding: number[] }>>();
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (label < 0) continue; // Skip noise

      if (!clusterMembers.has(label)) {
        clusterMembers.set(label, []);
      }
      clusterMembers.get(label)!.push(vectors[i]);
    }

    // Create clusters and assignments
    const assignments: ChunkClusterAssignment[] = [];
    const clusterSizes: number[] = [];

    for (const [label, members] of clusterMembers) {
      // Compute centroid
      const centroid = computeCentroid(members.map((m) => m.embedding));

      // Select exemplars (closest to centroid)
      const withDistances = members.map((m) => ({
        ...m,
        distance: angularDistance(m.embedding, centroid),
      }));
      withDistances.sort((a, b) => a.distance - b.distance);
      const exemplarIds = withDistances.slice(0, 3).map((m) => m.id);

      // Compute membership hash
      const memberIds = members.map((m) => m.id);
      const membershipHash = computeMembershipHash(memberIds);

      // Create cluster
      const clusterId = generateId();
      upsertCluster({
        id: clusterId,
        name: `Cluster ${label}`,
        centroid,
        exemplarIds,
        membershipHash,
      });

      // Create assignments
      for (const m of withDistances) {
        assignments.push({
          chunkId: m.id,
          clusterId,
          distance: m.distance,
        });
      }

      clusterSizes.push(members.length);
    }

    // Batch insert assignments
    if (assignments.length > 0) {
      assignChunksToClusters(assignments);
    }

    const noiseCount = labels.filter((l: number) => l < 0).length;

    return {
      numClusters: clusterMembers.size,
      assignedChunks: assignments.length,
      noiseChunks: noiseCount,
      noiseRatio: vectors.length > 0 ? noiseCount / vectors.length : 0,
      clusterSizes: clusterSizes.sort((a, b) => b - a),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Assign a new chunk to existing clusters based on angular distance.
   * Returns IDs of clusters the chunk was assigned to.
   */
  async assignChunkToClusters(
    chunkId: string,
    embedding: number[],
    options: { threshold?: number } = {}
  ): Promise<string[]> {
    const threshold = options.threshold ?? this.config.clusterThreshold;
    const clusters = getAllClusters();
    const assigned: string[] = [];
    const assignments: ChunkClusterAssignment[] = [];

    for (const cluster of clusters) {
      if (!cluster.centroid) continue;

      const distance = angularDistance(embedding, cluster.centroid);
      if (distance < threshold) {
        assignments.push({
          chunkId,
          clusterId: cluster.id,
          distance,
        });
        assigned.push(cluster.id);
      }
    }

    if (assignments.length > 0) {
      assignChunksToClusters(assignments);
    }

    return assigned;
  }

  /**
   * Assign multiple new chunks to existing clusters.
   */
  async assignNewChunks(
    chunks: Array<{ id: string; embedding: number[] }>,
    options: { threshold?: number } = {}
  ): Promise<{ assigned: number; total: number }> {
    let assignedCount = 0;

    for (const chunk of chunks) {
      const assigned = await this.assignChunkToClusters(chunk.id, chunk.embedding, options);
      if (assigned.length > 0) {
        assignedCount++;
      }
    }

    return { assigned: assignedCount, total: chunks.length };
  }

  /**
   * Update cluster centroids based on current membership.
   */
  async updateCentroids(): Promise<number> {
    const clusters = getAllClusters();
    let updated = 0;

    for (const cluster of clusters) {
      const chunkIds = getClusterChunkIds(cluster.id);
      if (chunkIds.length === 0) continue;

      // Get embeddings for all chunks
      const embeddings: number[][] = [];
      for (const id of chunkIds) {
        const embedding = await vectorStore.get(id);
        if (embedding) {
          embeddings.push(embedding);
        }
      }

      if (embeddings.length === 0) continue;

      // Compute new centroid
      const centroid = computeCentroid(embeddings);

      // Update cluster
      upsertCluster({
        id: cluster.id,
        centroid,
        membershipHash: computeMembershipHash(chunkIds),
      });

      updated++;
    }

    return updated;
  }

  /**
   * Get cluster statistics.
   */
  async getStats(): Promise<{
    numClusters: number;
    totalAssignments: number;
    avgClusterSize: number;
    largestCluster: number;
    smallestCluster: number;
  }> {
    const clusters = getAllClusters();
    let totalAssignments = 0;
    let largest = 0;
    let smallest = Infinity;

    for (const cluster of clusters) {
      const size = getClusterChunkIds(cluster.id).length;
      totalAssignments += size;
      largest = Math.max(largest, size);
      smallest = Math.min(smallest, size);
    }

    return {
      numClusters: clusters.length,
      totalAssignments,
      avgClusterSize: clusters.length > 0 ? totalAssignments / clusters.length : 0,
      largestCluster: largest,
      smallestCluster: smallest === Infinity ? 0 : smallest,
    };
  }

  /**
   * Find clusters similar to a query embedding.
   */
  async findSimilarClusters(
    queryEmbedding: number[],
    limit: number = 5
  ): Promise<Array<{ cluster: StoredCluster; distance: number }>> {
    const clusters = getAllClusters();
    const results: Array<{ cluster: StoredCluster; distance: number }> = [];

    for (const cluster of clusters) {
      if (!cluster.centroid) continue;

      const distance = angularDistance(queryEmbedding, cluster.centroid);
      results.push({ cluster, distance });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, limit);
  }
}

/**
 * Compute centroid of embeddings (mean vector, normalized).
 */
function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return [];
  }

  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      sum[i] += emb[i];
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    sum[i] /= embeddings.length;
    norm += sum[i] * sum[i];
  }

  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      sum[i] /= norm;
    }
  }

  return sum;
}

// Singleton instance
export const clusterManager = new ClusterManager();
