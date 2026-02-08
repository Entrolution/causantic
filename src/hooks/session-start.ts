/**
 * Session start hook handler.
 * Called when a new Claude Code session starts.
 * Returns memory context summary for the project.
 */

import { getAllClusters, getClusterChunkIds } from '../storage/cluster-store.js';
import { getChunksByIds, getChunksBySessionSlug } from '../storage/chunk-store.js';
import { getConfig } from '../config/memory-config.js';
import { approximateTokens } from '../utils/token-counter.js';
import { initStartupPrune } from '../storage/pruner.js';
import type { StoredCluster, StoredChunk } from '../storage/types.js';

/**
 * Options for session start handler.
 */
export interface SessionStartOptions {
  /** Maximum tokens for memory summary. Default: from config. */
  maxTokens?: number;
  /** Number of recent chunks to include. Default: 3. */
  includeRecent?: number;
  /** Number of cross-project clusters to include. Default: 2. */
  includeCrossProject?: number;
}

/**
 * Result of session start handler.
 */
export interface SessionStartResult {
  /** Memory summary text */
  summary: string;
  /** Token count */
  tokenCount: number;
  /** Clusters included */
  clustersIncluded: number;
  /** Recent chunks included */
  recentChunksIncluded: number;
}

/**
 * Handle session start.
 * Generates a memory summary for the project.
 *
 * @param projectPath - Project path (used as session slug)
 * @returns Memory summary result
 */
export async function handleSessionStart(
  projectPath: string,
  options: SessionStartOptions = {}
): Promise<SessionStartResult> {
  // Start background pruning (non-blocking, idempotent)
  initStartupPrune();

  const config = getConfig();
  const {
    maxTokens = config.claudeMdBudgetTokens,
    includeRecent = 3,
    includeCrossProject = 2,
  } = options;

  // Get clusters with descriptions
  const allClusters = getAllClusters();
  const clustersWithDesc = allClusters.filter((c) => c.description);

  // Get recent chunks for this project
  const projectChunks = getChunksBySessionSlug(projectPath);
  const recentChunks = projectChunks.slice(-includeRecent);

  // Build summary
  const parts: string[] = [];
  let currentTokens = 0;
  let clustersIncluded = 0;
  let recentIncluded = 0;

  // Add recent context first (most relevant)
  if (recentChunks.length > 0) {
    const recentSection = buildRecentSection(recentChunks);
    const recentTokens = approximateTokens(recentSection);

    if (currentTokens + recentTokens <= maxTokens) {
      parts.push(recentSection);
      currentTokens += recentTokens;
      recentIncluded = recentChunks.length;
    }
  }

  // Add project-relevant clusters
  const projectClusters = findProjectClusters(clustersWithDesc, projectPath);
  for (const cluster of projectClusters.slice(0, 5)) {
    const clusterSection = buildClusterSection(cluster);
    const clusterTokens = approximateTokens(clusterSection);

    if (currentTokens + clusterTokens > maxTokens) break;

    parts.push(clusterSection);
    currentTokens += clusterTokens;
    clustersIncluded++;
  }

  // Add cross-project clusters if space remains
  if (includeCrossProject > 0) {
    const crossProjectClusters = clustersWithDesc
      .filter((c) => !projectClusters.includes(c))
      .slice(0, includeCrossProject);

    for (const cluster of crossProjectClusters) {
      const clusterSection = buildClusterSection(cluster);
      const clusterTokens = approximateTokens(clusterSection);

      if (currentTokens + clusterTokens > maxTokens) break;

      parts.push(clusterSection);
      currentTokens += clusterTokens;
      clustersIncluded++;
    }
  }

  const summary = parts.length > 0 ? parts.join('\n\n') : 'No memory context available yet.';

  return {
    summary,
    tokenCount: currentTokens,
    clustersIncluded,
    recentChunksIncluded: recentIncluded,
  };
}

/**
 * Build the recent context section.
 */
function buildRecentSection(chunks: StoredChunk[]): string {
  const lines = ['## Recent Context'];

  for (const chunk of chunks) {
    const date = new Date(chunk.startTime).toLocaleDateString();
    const preview = chunk.content.slice(0, 200).replace(/\n/g, ' ');
    lines.push(`- [${date}] ${preview}${chunk.content.length > 200 ? '...' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Build a cluster section.
 */
function buildClusterSection(cluster: StoredCluster): string {
  const name = cluster.name ?? 'Unnamed Topic';
  const description = cluster.description ?? 'No description available.';

  return `### ${name}\n${description}`;
}

/**
 * Find clusters relevant to a project.
 */
function findProjectClusters(clusters: StoredCluster[], projectPath: string): StoredCluster[] {
  const relevant: Array<{ cluster: StoredCluster; relevance: number }> = [];

  for (const cluster of clusters) {
    const chunkIds = getClusterChunkIds(cluster.id);
    const chunks = getChunksByIds(chunkIds);

    // Count chunks from this project
    const projectCount = chunks.filter((c) => c.sessionSlug === projectPath).length;

    if (projectCount > 0) {
      relevant.push({
        cluster,
        relevance: projectCount / chunks.length,
      });
    }
  }

  // Sort by relevance
  relevant.sort((a, b) => b.relevance - a.relevance);
  return relevant.map((r) => r.cluster);
}

/**
 * Generate memory section for CLAUDE.md.
 */
export async function generateMemorySection(
  projectPath: string,
  options: SessionStartOptions = {}
): Promise<string> {
  const result = await handleSessionStart(projectPath, options);

  if (result.tokenCount === 0) {
    return '';
  }

  return `## Memory Context

${result.summary}

---
*Memory summary: ${result.clustersIncluded} topics, ${result.recentChunksIncluded} recent items*
`;
}
