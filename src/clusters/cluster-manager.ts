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
import { angularDistance } from '../utils/angular-distance.js';
import { getConfig } from '../config/memory-config.js';
import { generateId } from '../storage/db.js';
import type { StoredCluster, ChunkClusterAssignment } from '../storage/types.js';

/**
 * Snapshot of an old cluster's label metadata and member set,
 * used for carrying forward labels through reclustering.
 */
export interface OldClusterSnapshot {
  name: string | null;
  description: string | null;
  refreshedAt: string | null;
  memberIds: Set<string>;
}

/**
 * Minimal info about a newly created cluster, used for overlap matching.
 */
export interface NewClusterInfo {
  clusterId: string;
  memberIds: Set<string>;
}

/**
 * Match new clusters to old clusters by Jaccard overlap, returning
 * a map of newClusterId → matched old snapshot. Uses greedy best-match
 * and consumes matched old clusters to prevent double-assignment.
 */
export function matchClustersByOverlap(
  oldClusters: OldClusterSnapshot[],
  newClusters: NewClusterInfo[],
  threshold: number = 0.5,
): Map<string, OldClusterSnapshot> {
  const result = new Map<string, OldClusterSnapshot>();
  const consumed = new Set<number>(); // indices into oldClusters

  // Build all (new, old) pairs with their Jaccard similarity
  const pairs: Array<{ newIdx: number; oldIdx: number; jaccard: number }> = [];

  for (let ni = 0; ni < newClusters.length; ni++) {
    const nc = newClusters[ni];
    for (let oi = 0; oi < oldClusters.length; oi++) {
      const oc = oldClusters[oi];
      // Skip old clusters without a meaningful label
      if (!oc.name || !oc.refreshedAt) continue;

      let intersectionSize = 0;
      for (const id of nc.memberIds) {
        if (oc.memberIds.has(id)) intersectionSize++;
      }
      const unionSize = nc.memberIds.size + oc.memberIds.size - intersectionSize;
      if (unionSize === 0) continue;

      const jaccard = intersectionSize / unionSize;
      if (jaccard >= threshold) {
        pairs.push({ newIdx: ni, oldIdx: oi, jaccard });
      }
    }
  }

  // Greedy: sort descending by Jaccard, assign best matches first
  pairs.sort((a, b) => b.jaccard - a.jaccard);

  const assignedNew = new Set<number>();
  for (const { newIdx, oldIdx } of pairs) {
    if (assignedNew.has(newIdx) || consumed.has(oldIdx)) continue;
    result.set(newClusters[newIdx].clusterId, oldClusters[oldIdx]);
    assignedNew.add(newIdx);
    consumed.add(oldIdx);
  }

  return result;
}

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
  /** Number of noise points reassigned to clusters via threshold pass */
  reassignedNoise: number;
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

    const { minClusterSize = this.config.minClusterSize, clearExisting = true } = options;

    // Snapshot old clusters before clearing so we can carry forward labels
    let oldSnapshots: OldClusterSnapshot[] = [];
    if (clearExisting) {
      const oldClusters = getAllClusters();
      oldSnapshots = oldClusters.map((c) => ({
        name: c.name,
        description: c.description,
        refreshedAt: c.refreshedAt,
        memberIds: new Set(getClusterChunkIds(c.id)),
      }));
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
        reassignedNoise: 0,
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
    const newClusterInfos: NewClusterInfo[] = [];

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

      newClusterInfos.push({
        clusterId,
        memberIds: new Set(memberIds),
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

    // Carry forward labels from old clusters that match new ones by member overlap
    if (oldSnapshots.length > 0 && newClusterInfos.length > 0) {
      const matches = matchClustersByOverlap(oldSnapshots, newClusterInfos);
      for (const [newClusterId, oldSnapshot] of matches) {
        upsertCluster({
          id: newClusterId,
          name: oldSnapshot.name ?? undefined,
          description: oldSnapshot.description ?? undefined,
        });
      }
    }

    const rawNoiseCount = labels.filter((l: number) => l < 0).length;

    // Noise reassignment pass: assign noise points to clusters within threshold
    const clusterThreshold = options.clusterThreshold ?? this.config.clusterThreshold;
    const noiseAssignments: ChunkClusterAssignment[] = [];
    const reassignedNoiseIds = new Set<string>();

    if (rawNoiseCount > 0 && clusterMembers.size > 0) {
      const clusters = getAllClusters();
      const noisePoints = vectors.filter((_, i) => labels[i] < 0);

      for (const point of noisePoints) {
        for (const cluster of clusters) {
          if (!cluster.centroid) continue;
          const distance = angularDistance(point.embedding, cluster.centroid);
          if (distance < clusterThreshold) {
            noiseAssignments.push({
              chunkId: point.id,
              clusterId: cluster.id,
              distance,
            });
            reassignedNoiseIds.add(point.id);
          }
        }
      }

      if (noiseAssignments.length > 0) {
        assignChunksToClusters(noiseAssignments);
        await this.updateCentroids();
      }
    }

    const noiseCount = rawNoiseCount - reassignedNoiseIds.size;

    return {
      numClusters: clusterMembers.size,
      assignedChunks: assignments.length + noiseAssignments.length,
      noiseChunks: noiseCount,
      noiseRatio: vectors.length > 0 ? noiseCount / vectors.length : 0,
      clusterSizes: clusterSizes.sort((a, b) => b - a),
      reassignedNoise: reassignedNoiseIds.size,
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
    options: { threshold?: number } = {},
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
    options: { threshold?: number } = {},
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
   * Reassign noise points (unassigned chunks) to clusters within threshold.
   * Runs only the threshold pass without HDBSCAN — useful for threshold experimentation.
   */
  async reassignNoisePoints(
    options: { threshold?: number } = {},
  ): Promise<{ reassigned: number; total: number }> {
    const threshold = options.threshold ?? this.config.clusterThreshold;
    const clusters = getAllClusters();

    if (clusters.length === 0) {
      return { reassigned: 0, total: 0 };
    }

    // Collect all currently-assigned chunk IDs
    const assignedIds = new Set<string>();
    for (const cluster of clusters) {
      for (const id of getClusterChunkIds(cluster.id)) {
        assignedIds.add(id);
      }
    }

    // Get all vectors and filter to unassigned
    const allVectors = await vectorStore.getAllVectors();
    const unassigned = allVectors.filter((v) => !assignedIds.has(v.id));

    if (unassigned.length === 0) {
      return { reassigned: 0, total: 0 };
    }

    // Threshold pass
    const assignments: ChunkClusterAssignment[] = [];
    const reassignedIds = new Set<string>();

    for (const point of unassigned) {
      for (const cluster of clusters) {
        if (!cluster.centroid) continue;
        const distance = angularDistance(point.embedding, cluster.centroid);
        if (distance < threshold) {
          assignments.push({
            chunkId: point.id,
            clusterId: cluster.id,
            distance,
          });
          reassignedIds.add(point.id);
        }
      }
    }

    if (assignments.length > 0) {
      assignChunksToClusters(assignments);
      await this.updateCentroids();
    }

    return { reassigned: reassignedIds.size, total: unassigned.length };
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
    limit: number = 5,
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
