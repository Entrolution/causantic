/**
 * Post-fusion cluster expansion.
 *
 * Expands search results by finding sibling chunks within the same HDBSCAN clusters.
 * This surfaces topically related chunks that neither vector nor keyword search found.
 */

import { getChunkClusterAssignments, getClusterChunkIds } from '../storage/cluster-store.js';
import { vectorStore } from '../storage/vector-store.js';
import type { RankedItem } from './rrf.js';

export interface ClusterExpansionConfig {
  /** Max clusters to expand from (default: 3) */
  maxClusters: number;
  /** Max sibling chunks per cluster (default: 5) */
  maxSiblings: number;
}

export const DEFAULT_CLUSTER_EXPANSION: ClusterExpansionConfig = {
  maxClusters: 3,
  maxSiblings: 5,
};

/**
 * Expand hits with cluster siblings.
 *
 * For each hit, looks up its cluster assignments, then fetches sibling chunks
 * from the top clusters. Siblings get scored based on the hit's score
 * and their distance to the cluster centroid.
 *
 * @param hits - Ranked items from RRF fusion
 * @param config - Expansion parameters
 * @param projectFilter - Optional project filter to restrict siblings
 * @returns Original hits + cluster sibling items (deduplicated)
 */
export function expandViaClusters(
  hits: RankedItem[],
  config: ClusterExpansionConfig = DEFAULT_CLUSTER_EXPANSION,
  projectFilter?: string | string[],
): RankedItem[] {
  if (hits.length === 0) return [];

  const existingIds = new Set(hits.map((h) => h.chunkId));
  const siblingItems: RankedItem[] = [];

  // Build project filter set
  const projectSet = projectFilter
    ? new Set(Array.isArray(projectFilter) ? projectFilter : [projectFilter])
    : null;

  // Track clusters we've already expanded to avoid duplicates
  const expandedClusters = new Set<string>();
  let clusterCount = 0;

  for (const hit of hits) {
    if (clusterCount >= config.maxClusters) break;

    // Get cluster assignments for this chunk (sorted by distance)
    const assignments = getChunkClusterAssignments(hit.chunkId);
    if (assignments.length === 0) continue;

    for (const assignment of assignments) {
      if (clusterCount >= config.maxClusters) break;
      if (expandedClusters.has(assignment.clusterId)) continue;

      expandedClusters.add(assignment.clusterId);
      clusterCount++;

      // Get all chunk IDs in this cluster
      const clusterChunkIds = getClusterChunkIds(assignment.clusterId);
      let addedSiblings = 0;

      for (const siblingId of clusterChunkIds) {
        if (addedSiblings >= config.maxSiblings) break;
        if (existingIds.has(siblingId)) continue;

        // Filter by project if needed
        if (projectSet) {
          const project = vectorStore.getChunkProject(siblingId);
          if (!project || !projectSet.has(project)) continue;
        }

        // Look up this sibling's distance in the cluster for scoring
        const siblingAssignments = getChunkClusterAssignments(siblingId);
        const siblingAssignment = siblingAssignments.find(
          (a) => a.clusterId === assignment.clusterId,
        );
        const distance = siblingAssignment?.distance ?? 0.5;

        // Score: best hit score * (1 - distance)
        // MMR reranking (downstream) handles diversity — no boost penalty needed here.
        const score = hit.score * (1 - distance);

        if (score > 0) {
          siblingItems.push({
            chunkId: siblingId,
            score,
            source: 'cluster',
          });
          existingIds.add(siblingId);
          addedSiblings++;
        }
      }
    }
  }

  // Combine original hits with siblings
  return [...hits, ...siblingItems];
}
