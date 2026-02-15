/**
 * Session start hook handler.
 * Called when a new Claude Code session starts.
 * Returns memory context summary for the project.
 *
 * Features:
 * - Retry logic for transient errors
 * - Structured JSON logging
 * - Execution metrics
 * - Graceful degradation on failure
 */

import { basename } from 'node:path';
import { getAllClusters, getClusterChunkIds } from '../storage/cluster-store.js';
import {
  getChunksByIds,
  getChunksBySessionSlug,
  getSessionsForProject,
  getChunksByTimeRange,
} from '../storage/chunk-store.js';
import { getConfig } from '../config/memory-config.js';
import { approximateTokens } from '../utils/token-counter.js';
import { runStaleMaintenanceTasks } from '../maintenance/scheduler.js';
import { executeHook, logHook, isTransientError, type HookMetrics } from './hook-utils.js';
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
  /** Enable retry on transient errors. Default: true */
  enableRetry?: boolean;
  /** Maximum retries. Default: 3 */
  maxRetries?: number;
  /** Return fallback on total failure. Default: true */
  gracefulDegradation?: boolean;
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
  /** Whether last session summary was included */
  lastSessionIncluded: boolean;
  /** Hook execution metrics */
  metrics?: HookMetrics;
  /** Whether this is a fallback result due to error */
  degraded?: boolean;
}

/**
 * Internal handler without retry logic.
 */
function internalHandleSessionStart(
  projectPath: string,
  options: SessionStartOptions,
): SessionStartResult {
  const config = getConfig();
  const {
    maxTokens = config.claudeMdBudgetTokens,
    includeRecent = 3,
    includeCrossProject = 2,
  } = options;

  // Get clusters with descriptions
  const allClusters = getAllClusters();
  const clustersWithDesc = allClusters.filter((c) => c.description);

  logHook({
    level: 'debug',
    hook: 'session-start',
    event: 'clusters_loaded',
    details: { total: allClusters.length, withDescription: clustersWithDesc.length },
  });

  // Get recent chunks for this project
  const projectChunks = getChunksBySessionSlug(projectPath);
  const recentChunks = projectChunks.slice(-includeRecent);

  logHook({
    level: 'debug',
    hook: 'session-start',
    event: 'chunks_loaded',
    details: { total: projectChunks.length, recent: recentChunks.length },
  });

  // Build summary
  const parts: string[] = [];
  let currentTokens = 0;
  let clustersIncluded = 0;
  let recentIncluded = 0;
  let lastSessionIncluded = false;

  // Reserve ~20% of token budget for last-session summary
  const lastSessionBudget = Math.floor(maxTokens * 0.2);
  const mainBudget = maxTokens - lastSessionBudget;

  // Add recent context first (most relevant)
  if (recentChunks.length > 0) {
    const recentSection = buildRecentSection(recentChunks);
    const recentTokens = approximateTokens(recentSection);

    if (currentTokens + recentTokens <= mainBudget) {
      parts.push(recentSection);
      currentTokens += recentTokens;
      recentIncluded = recentChunks.length;
    }
  }

  // Add last session summary if available (within last 7 days)
  const lastSessionSection = buildLastSessionSection(projectPath, lastSessionBudget);
  if (lastSessionSection) {
    const sectionTokens = approximateTokens(lastSessionSection);
    parts.push(lastSessionSection);
    currentTokens += sectionTokens;
    lastSessionIncluded = true;

    logHook({
      level: 'debug',
      hook: 'session-start',
      event: 'last_session_included',
      details: { tokens: sectionTokens },
    });
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
    lastSessionIncluded,
  };
}

/**
 * Handle session start.
 * Generates a memory summary for the project.
 *
 * @param projectPath - Project path (used as session slug)
 * @param options - Session start options
 * @returns Memory summary result
 */
export async function handleSessionStart(
  projectPath: string,
  options: SessionStartOptions = {},
): Promise<SessionStartResult> {
  const { enableRetry = true, maxRetries = 3, gracefulDegradation = true } = options;

  // Run stale maintenance tasks in background (prune, recluster)
  // Covers cases where scheduled cron times were missed (e.g. laptop asleep)
  runStaleMaintenanceTasks();

  const fallbackResult: SessionStartResult = {
    summary: 'Memory context temporarily unavailable.',
    tokenCount: 0,
    clustersIncluded: 0,
    recentChunksIncluded: 0,
    lastSessionIncluded: false,
    degraded: true,
  };

  try {
    const { result, metrics } = await executeHook(
      'session-start',
      async () => internalHandleSessionStart(projectPath, options),
      {
        retry: enableRetry
          ? {
              maxRetries,
              retryOn: isTransientError,
            }
          : undefined,
        fallback: gracefulDegradation ? undefined : undefined,
        project: basename(projectPath) || projectPath,
      },
    );

    return {
      ...result,
      metrics,
    };
  } catch (error) {
    if (!gracefulDegradation) throw error;

    const hint = classifyError(error);
    return {
      ...fallbackResult,
      summary: `Memory context temporarily unavailable (${hint} — will retry next session).`,
    };
  }
}

/**
 * Classify an error into a short diagnostic hint.
 */
export function classifyError(error: unknown): string {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (msg.includes('database is locked') || msg.includes('busy') || msg.includes('sqlite_busy')) {
    return 'database busy';
  }
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return 'database not found';
  }
  if (
    msg.includes('embed') ||
    msg.includes('model') ||
    msg.includes('onnx') ||
    msg.includes('inference')
  ) {
    return 'embedder unavailable';
  }
  return 'internal error';
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
 * Build a last-session summary section.
 * Looks for the most recent session within the last 7 days and
 * includes a brief preview from its final chunks.
 *
 * @returns The section string, or null if no recent session found
 */
function buildLastSessionSection(projectPath: string, tokenBudget: number): string | null {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sessions = getSessionsForProject(projectPath, sevenDaysAgo);

  if (sessions.length === 0) return null;

  // Most recent session (already sorted DESC by firstChunkTime)
  const lastSession = sessions[0];

  const sessionDate = new Date(lastSession.firstChunkTime).toLocaleDateString();
  const sessionTime = new Date(lastSession.firstChunkTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines = [`## Last Session (${sessionDate} ${sessionTime})`];

  // Get chunks from that session and take the final 3-5
  const chunks = getChunksByTimeRange(
    projectPath,
    lastSession.firstChunkTime,
    // Add 1ms to include the last chunk (start_time < to)
    new Date(new Date(lastSession.lastChunkTime).getTime() + 1).toISOString(),
  );
  const tailChunks = chunks.slice(-5);

  for (const chunk of tailChunks) {
    const preview = chunk.content.slice(0, 150).replace(/\n/g, ' ');
    const line = `- ${preview}${chunk.content.length > 150 ? '...' : ''}`;
    const candidate = [...lines, line].join('\n');

    if (approximateTokens(candidate) > tokenBudget) break;

    lines.push(line);
  }

  // Only return if we got at least one chunk preview
  if (lines.length <= 1) return null;

  return lines.join('\n');
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
  options: SessionStartOptions = {},
): Promise<string> {
  const result = await handleSessionStart(projectPath, options);

  if (result.tokenCount === 0 && !result.degraded) {
    return '';
  }

  if (result.degraded) {
    return `## Memory Context

*Memory system temporarily unavailable. Will be restored on next session.*
`;
  }

  const lastSessionNote = result.lastSessionIncluded ? ', last session included' : '';

  return `## Memory Context

${result.summary}

---
*Memory summary: ${result.clustersIncluded} topics, ${result.recentChunksIncluded} recent items${lastSessionNote}*
`;
}
