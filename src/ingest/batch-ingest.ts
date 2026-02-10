/**
 * Batch ingestion with parallelism and progress tracking.
 * Ingests entire corpus with resumption support.
 * Uses memory-based concurrency calculation for optimal performance.
 */

import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { isSessionIngested } from '../storage/chunk-store.js';
import { ingestSession, type IngestResult, type IngestOptions } from './ingest-session.js';
import { linkAllSessions } from './cross-session-linker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('batch-ingest');

/**
 * Progress information passed to callback.
 */
export interface BatchProgress {
  /** Sessions completed so far */
  done: number;
  /** Total sessions to process */
  total: number;
  /** Current session path (empty after completion) */
  current: string;
  /** Running total of chunks created */
  totalChunks: number;
  /** Running total of sessions successfully ingested */
  successCount: number;
}

/**
 * Options for batch ingestion.
 */
export interface BatchIngestOptions {
  /** Progress callback (called after each session completes). */
  progressCallback?: (progress: BatchProgress) => void;
  /** Session ID to resume from (skip sessions before this). */
  resumeFrom?: string;
  /** Embedding model ID. Default: 'jina-small'. */
  embeddingModel?: string;
  /** Skip already-ingested sessions. Default: true. */
  skipExisting?: boolean;
  /** Link cross-sessions after batch. Default: true. */
  linkCrossSessions?: boolean;
  /** Use incremental ingestion (resume from checkpoints). Default: true. */
  useIncrementalIngestion?: boolean;
  /** Use embedding cache. Default: true. */
  useEmbeddingCache?: boolean;
  /** Override embedding device ('auto' | 'coreml' | 'cuda' | 'cpu' | 'wasm'). */
  embeddingDevice?: string;
  /** Shared embedder instance (avoids reloading model per batch). */
  embedder?: Embedder;
}

/**
 * Result of batch ingestion.
 */
export interface BatchIngestResult {
  /** Total sessions found */
  totalSessions: number;
  /** Successfully ingested */
  successCount: number;
  /** Skipped (already existed) */
  skippedCount: number;
  /** Errors encountered */
  errorCount: number;
  /** Total chunks created */
  totalChunks: number;
  /** Total edges created */
  totalEdges: number;
  /** Cross-session edges created */
  crossSessionEdges: number;
  /** Sub-agent edges (brief + debrief) created */
  subAgentEdges: number;
  /** Total sub-agents processed */
  subAgentCount: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Per-session results */
  results: IngestResult[];
  /** Errors */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Discover session JSONL files in a directory.
 */
export async function discoverSessions(dir: string): Promise<string[]> {
  const sessions: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      log.debug(`Skipping inaccessible directory: ${currentDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        // Check if it's a session file (has UUID-like name)
        const name = basename(entry.name, '.jsonl');
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
          sessions.push(fullPath);
        }
      }
    }
  }

  await walk(dir);

  // Sort by modification time (oldest first for deterministic ordering)
  const withStats = await Promise.all(
    sessions.map(async (path) => {
      try {
        const stats = await stat(path);
        return { path, mtime: stats.mtime.getTime() };
      } catch (err) {
        log.warn(`Failed to stat session file: ${path}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { path, mtime: 0 };
      }
    })
  );

  withStats.sort((a, b) => a.mtime - b.mtime);
  return withStats.map((s) => s.path);
}

/**
 * Filter out already-ingested sessions.
 */
export async function filterAlreadyIngested(sessionPaths: string[]): Promise<string[]> {
  // We need to check by session ID, not path
  // For now, just return all paths - the ingest function will skip
  return sessionPaths;
}

/**
 * Batch ingest sessions from paths.
 */
export async function batchIngest(
  sessionPaths: string[],
  options: BatchIngestOptions = {}
): Promise<BatchIngestResult> {
  const startTime = Date.now();

  const {
    progressCallback,
    resumeFrom,
    embeddingModel = 'jina-small',
    skipExisting = true,
    linkCrossSessions = true,
    useIncrementalIngestion = true,
    useEmbeddingCache = true,
    embeddingDevice,
  } = options;

  // Filter to sessions after resumeFrom
  let toProcess = sessionPaths;
  if (resumeFrom) {
    const resumeIndex = sessionPaths.findIndex((p) => p.includes(resumeFrom));
    if (resumeIndex >= 0) {
      toProcess = sessionPaths.slice(resumeIndex + 1);
    }
  }

  const results: IngestResult[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  // Use provided embedder or create one — avoids reloading model per batch
  const embedder = options.embedder ?? new Embedder();
  const ownsEmbedder = !options.embedder;
  if (!embedder.currentModel || embedder.currentModel.id !== embeddingModel) {
    await embedder.load(getModel(embeddingModel), { device: embeddingDevice });
  }

  const ingestOptions: IngestOptions = {
    embeddingModel,
    skipIfExists: skipExisting,
    linkCrossSessions: false, // We'll do this after all sessions
    embedder,
    useIncrementalIngestion,
    useEmbeddingCache,
    embeddingDevice,
  };

  // Track running totals for progress
  let runningChunks = 0;
  let runningSuccess = 0;

  try {
    // Process sessions sequentially (parallelism is inside each session via pool)
    for (let i = 0; i < toProcess.length; i++) {
      const path = toProcess[i];

      try {
        const result = await ingestSession(path, ingestOptions);
        results.push(result);
        runningChunks += result.chunkCount;
        if (!result.skipped) {
          runningSuccess++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ path, error: message });
      }

      progressCallback?.({
        done: i + 1,
        total: toProcess.length,
        current: path,
        totalChunks: runningChunks,
        successCount: runningSuccess,
      });
    }

    // Link cross-sessions after all sessions are ingested
    let crossSessionEdges = 0;
    if (linkCrossSessions) {
      const linkResult = await linkAllSessions();
      crossSessionEdges = linkResult.totalEdges;
    }

    const successCount = results.filter((r) => !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;

    return {
      totalSessions: toProcess.length,
      successCount,
      skippedCount,
      errorCount: errors.length,
      totalChunks: results.reduce((sum, r) => sum + r.chunkCount, 0),
      totalEdges: results.reduce((sum, r) => sum + r.edgeCount, 0),
      crossSessionEdges,
      subAgentEdges: results.reduce((sum, r) => sum + (r.subAgentEdges ?? 0), 0),
      subAgentCount: results.reduce((sum, r) => sum + (r.subAgentCount ?? 0), 0),
      durationMs: Date.now() - startTime,
      results,
      errors,
    };
  } finally {
    if (ownsEmbedder) {
      await embedder.dispose();
    }
  }
}

/**
 * Discover and ingest all sessions in a directory.
 */
export async function batchIngestDirectory(
  dir: string,
  options: BatchIngestOptions = {}
): Promise<BatchIngestResult> {
  const sessionPaths = await discoverSessions(dir);
  return batchIngest(sessionPaths, options);
}
