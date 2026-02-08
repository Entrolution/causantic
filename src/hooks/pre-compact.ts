/**
 * Pre-compact hook handler.
 * Called before a Claude Code session is compacted.
 * Ingests the session into the memory system.
 */

import { ingestSession } from '../ingest/ingest-session.js';
import { clusterManager } from '../clusters/cluster-manager.js';
import { vectorStore } from '../storage/vector-store.js';

/**
 * Result of pre-compact hook execution.
 */
export interface PreCompactResult {
  /** Session ID that was ingested */
  sessionId: string;
  /** Number of chunks created */
  chunkCount: number;
  /** Number of edges created */
  edgeCount: number;
  /** Number of clusters the new chunks were assigned to */
  clustersAssigned: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Whether ingestion was skipped (already existed) */
  skipped: boolean;
}

/**
 * Handle pre-compact hook.
 * Called by Claude Code before session compaction.
 *
 * @param sessionPath - Path to the session JSONL file
 * @returns Result of the ingestion
 */
export async function handlePreCompact(sessionPath: string): Promise<PreCompactResult> {
  const startTime = Date.now();

  // Ingest the session
  const ingestResult = await ingestSession(sessionPath, {
    skipIfExists: true,
    linkCrossSessions: true,
  });

  if (ingestResult.skipped) {
    return {
      sessionId: ingestResult.sessionId,
      chunkCount: 0,
      edgeCount: 0,
      clustersAssigned: 0,
      durationMs: Date.now() - startTime,
      skipped: true,
    };
  }

  // Assign new chunks to existing clusters
  let clustersAssigned = 0;
  if (ingestResult.chunkCount > 0) {
    // Get the newly created chunk embeddings
    const vectors = await vectorStore.getAllVectors();
    // Filter to just the new session's chunks (rough heuristic: recent ones)
    const recentVectors = vectors.slice(-ingestResult.chunkCount);

    const assignResult = await clusterManager.assignNewChunks(recentVectors);
    clustersAssigned = assignResult.assigned;
  }

  return {
    sessionId: ingestResult.sessionId,
    chunkCount: ingestResult.chunkCount,
    edgeCount: ingestResult.edgeCount,
    clustersAssigned,
    durationMs: Date.now() - startTime,
    skipped: false,
  };
}

/**
 * CLI entry point for pre-compact hook.
 */
export async function preCompactCli(sessionPath: string): Promise<void> {
  try {
    const result = await handlePreCompact(sessionPath);

    if (result.skipped) {
      console.log(`Session ${result.sessionId} already ingested, skipped.`);
    } else {
      console.log(`Ingested session ${result.sessionId}:`);
      console.log(`  Chunks: ${result.chunkCount}`);
      console.log(`  Edges: ${result.edgeCount}`);
      console.log(`  Clusters assigned: ${result.clustersAssigned}`);
      console.log(`  Duration: ${result.durationMs}ms`);
    }
  } catch (error) {
    console.error('Pre-compact hook failed:', error);
    process.exit(1);
  }
}
