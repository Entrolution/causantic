/**
 * Collection health benchmarks.
 *
 * Fast metrics that require no embedder — always runs even with --quick.
 * Measures collection structure, graph density, cluster coverage, and orphan rate.
 */

import { getAllChunks, getChunkCount, getSessionIds, getDistinctProjects } from '../../storage/chunk-store.js';
import { getEdgeCount, getAllEdges } from '../../storage/edge-store.js';
import {
  getClusterCount,
  getAllClusters,
  getClusterChunkIds,
} from '../../storage/cluster-store.js';
import { vectorStore } from '../../storage/vector-store.js';
import { angularDistance } from '../../utils/angular-distance.js';
import type { StoredChunk, ReferenceType } from '../../storage/types.js';
import type {
  HealthResult,
  EdgeTypeDistribution,
  SessionSizeStats,
  ClusterQuality,
  ProjectBreakdown,
} from './types.js';

/**
 * Compute the median of an array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run collection health benchmarks.
 */
export async function runHealthBenchmarks(
  includeClusterQuality: boolean = false,
): Promise<HealthResult> {
  const chunks = getAllChunks();
  const chunkCount = chunks.length;
  const projects = getDistinctProjects();
  const projectCount = projects.length;
  const sessionIds = getSessionIds();
  const sessionCount = sessionIds.length;
  const edgeCount = getEdgeCount();
  const clusterCount = getClusterCount();

  // Edge-to-chunk ratio
  const edgeToChunkRatio = chunkCount > 0 ? edgeCount / chunkCount : 0;

  // Cluster coverage: chunks that belong to at least one cluster
  const allClusters = getAllClusters();
  const chunksInClusters = new Set<string>();
  for (const cluster of allClusters) {
    const memberIds = getClusterChunkIds(cluster.id);
    for (const id of memberIds) {
      chunksInClusters.add(id);
    }
  }
  const clusterCoverage = chunkCount > 0 ? chunksInClusters.size / chunkCount : 0;

  // Orphan chunks: no edges AND not in any cluster
  const edges = getAllEdges();
  const chunksWithEdges = new Set<string>();
  for (const edge of edges) {
    chunksWithEdges.add(edge.sourceChunkId);
    chunksWithEdges.add(edge.targetChunkId);
  }
  let orphanCount = 0;
  for (const chunk of chunks) {
    if (!chunksWithEdges.has(chunk.id) && !chunksInClusters.has(chunk.id)) {
      orphanCount++;
    }
  }
  const orphanChunkPercentage = chunkCount > 0 ? orphanCount / chunkCount : 0;

  // Temporal span
  let temporalSpan: { earliest: string; latest: string } | null = null;
  if (chunks.length > 0) {
    const times = chunks.map(c => c.startTime).sort();
    temporalSpan = { earliest: times[0], latest: times[times.length - 1] };
  }

  // Edge type distribution
  const edgeTypeCounts = new Map<string, number>();
  for (const edge of edges) {
    const type = edge.referenceType ?? 'unknown';
    edgeTypeCounts.set(type, (edgeTypeCounts.get(type) ?? 0) + 1);
  }
  const edgeTypeDistribution: EdgeTypeDistribution[] = [...edgeTypeCounts.entries()]
    .map(([type, count]) => ({
      type: type as ReferenceType,
      count,
      percentage: edgeCount > 0 ? count / edgeCount : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Session size stats
  let sessionSizeStats: SessionSizeStats | null = null;
  if (sessionCount > 0) {
    const sessionChunkCounts = new Map<string, number>();
    for (const chunk of chunks) {
      sessionChunkCounts.set(chunk.sessionId, (sessionChunkCounts.get(chunk.sessionId) ?? 0) + 1);
    }
    const counts = [...sessionChunkCounts.values()];
    sessionSizeStats = {
      min: Math.min(...counts),
      max: Math.max(...counts),
      mean: counts.reduce((a, b) => a + b, 0) / counts.length,
      median: median(counts),
    };
  }

  // Per-project breakdown
  const perProject: ProjectBreakdown[] = [];
  if (projectCount > 0) {
    const projectChunkCounts = new Map<string, number>();
    const projectEdgeCounts = new Map<string, number>();
    const projectClusterCounts = new Map<string, Set<string>>();
    const projectChunksWithEdges = new Map<string, Set<string>>();
    const projectChunksInClusters = new Map<string, Set<string>>();

    for (const chunk of chunks) {
      projectChunkCounts.set(chunk.sessionSlug, (projectChunkCounts.get(chunk.sessionSlug) ?? 0) + 1);
    }

    // Build chunk-to-project map
    const chunkToProject = new Map<string, string>();
    for (const chunk of chunks) {
      chunkToProject.set(chunk.id, chunk.sessionSlug);
    }

    for (const edge of edges) {
      const proj = chunkToProject.get(edge.sourceChunkId);
      if (proj) {
        projectEdgeCounts.set(proj, (projectEdgeCounts.get(proj) ?? 0) + 1);
        const edgeSet = projectChunksWithEdges.get(proj) ?? new Set();
        edgeSet.add(edge.sourceChunkId);
        edgeSet.add(edge.targetChunkId);
        projectChunksWithEdges.set(proj, edgeSet);
      }
    }

    for (const cluster of allClusters) {
      const memberIds = getClusterChunkIds(cluster.id);
      for (const id of memberIds) {
        const proj = chunkToProject.get(id);
        if (proj) {
          const clusterSet = projectClusterCounts.get(proj) ?? new Set();
          clusterSet.add(cluster.id);
          projectClusterCounts.set(proj, clusterSet);

          const inCluster = projectChunksInClusters.get(proj) ?? new Set();
          inCluster.add(id);
          projectChunksInClusters.set(proj, inCluster);
        }
      }
    }

    for (const project of projects) {
      const pChunkCount = projectChunkCounts.get(project.slug) ?? 0;
      const pEdgeCount = projectEdgeCounts.get(project.slug) ?? 0;
      const pClusterCount = projectClusterCounts.get(project.slug)?.size ?? 0;

      const pChunksWithEdges = projectChunksWithEdges.get(project.slug) ?? new Set();
      const pChunksInClusters = projectChunksInClusters.get(project.slug) ?? new Set();

      let orphans = 0;
      for (const chunk of chunks) {
        if (chunk.sessionSlug === project.slug &&
            !pChunksWithEdges.has(chunk.id) &&
            !pChunksInClusters.has(chunk.id)) {
          orphans++;
        }
      }

      perProject.push({
        slug: project.slug,
        chunkCount: pChunkCount,
        edgeCount: pEdgeCount,
        clusterCount: pClusterCount,
        orphanPercentage: pChunkCount > 0 ? orphans / pChunkCount : 0,
      });
    }
  }

  // Cluster quality (requires embedder/vectors loaded)
  let clusterQuality: ClusterQuality | null = null;
  if (includeClusterQuality && allClusters.length >= 2) {
    clusterQuality = await computeClusterQuality(allClusters);
  }

  return {
    chunkCount,
    projectCount,
    sessionCount,
    edgeCount,
    edgeToChunkRatio,
    clusterCount,
    clusterCoverage,
    orphanChunkPercentage,
    temporalSpan,
    edgeTypeDistribution,
    sessionSizeStats,
    perProject,
    clusterQuality,
  };
}

/**
 * Compute cluster quality metrics using stored embeddings.
 */
async function computeClusterQuality(
  clusters: Array<{ id: string; centroid: number[] | null }>,
): Promise<ClusterQuality | null> {
  // Find clusters with >= 2 members and centroids
  const eligibleClusters: Array<{ id: string; centroid: number[]; memberIds: string[] }> = [];

  for (const cluster of clusters) {
    if (!cluster.centroid) continue;
    const memberIds = getClusterChunkIds(cluster.id);
    if (memberIds.length >= 2) {
      eligibleClusters.push({
        id: cluster.id,
        centroid: cluster.centroid,
        memberIds,
      });
    }
  }

  if (eligibleClusters.length < 2) return null;

  // Intra-cluster similarity: mean pairwise cosine similarity within each cluster
  let totalIntraSim = 0;
  let intraCount = 0;

  for (const cluster of eligibleClusters) {
    const embeddings: number[][] = [];
    for (const id of cluster.memberIds) {
      const vec = await vectorStore.get(id);
      if (vec) embeddings.push(vec);
    }

    if (embeddings.length < 2) continue;

    // Sample pairwise comparisons (cap at 100 pairs per cluster)
    let pairCount = 0;
    let simSum = 0;
    for (let i = 0; i < embeddings.length && pairCount < 100; i++) {
      for (let j = i + 1; j < embeddings.length && pairCount < 100; j++) {
        const dist = angularDistance(embeddings[i], embeddings[j]);
        simSum += 1 - dist; // Convert distance to similarity
        pairCount++;
      }
    }
    if (pairCount > 0) {
      totalIntraSim += simSum / pairCount;
      intraCount++;
    }
  }

  const intraClusterSimilarity = intraCount > 0 ? totalIntraSim / intraCount : 0;

  // Inter-cluster separation: mean cosine distance between centroids
  let interSum = 0;
  let interCount = 0;
  for (let i = 0; i < eligibleClusters.length; i++) {
    for (let j = i + 1; j < eligibleClusters.length; j++) {
      interSum += angularDistance(eligibleClusters[i].centroid, eligibleClusters[j].centroid);
      interCount++;
    }
  }
  const interClusterSeparation = interCount > 0 ? interSum / interCount : 0;

  // Coherence score: intra / (intra + inter)
  const coherenceScore = (intraClusterSimilarity + interClusterSeparation) > 0
    ? intraClusterSimilarity / (intraClusterSimilarity + interClusterSeparation)
    : 0;

  return {
    intraClusterSimilarity,
    interClusterSeparation,
    coherenceScore,
  };
}
