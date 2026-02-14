/**
 * Session ingestion orchestrator.
 * Parses, chunks, embeds, and stores a single session.
 * Supports sub-agent discovery and performance optimizations:
 * - True batch embedding for faster inference
 * - Content-hash caching to skip unchanged content
 * - Incremental ingestion via checkpoints
 * - File mtime checks to skip unchanged files
 * - Streaming for large files
 */

import { stat } from 'fs/promises';
import {
  readSessionMessages,
  getSessionInfo,
  discoverSubAgents,
  streamSessionMessages,
  deriveProjectSlug,
  type SubAgentInfo,
} from '../parser/session-reader.js';
import { assembleTurns, assembleTurnsFromStream } from '../parser/turn-assembler.js';
import { chunkTurns } from '../parser/chunker.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { insertChunks, isSessionIngested } from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { detectCausalTransitions } from './edge-detector.js';
import {
  createEdgesFromTransitions,
  createBriefEdge,
  createDebriefEdge,
} from './edge-creator.js';
import { linkCrossSession } from './cross-session-linker.js';
import {
  detectBriefPoints,
  detectDebriefPoints,
  buildChunkIdsByTurn,
} from './brief-debrief-detector.js';
import { getCheckpoint, saveCheckpoint } from '../storage/checkpoint-store.js';
import {
  computeContentHash,
  getCachedEmbeddingsBatch,
  cacheEmbeddingsBatch,
} from '../storage/embedding-cache.js';
import type { ChunkInput } from '../storage/types.js';
import type { Chunk, Turn } from '../parser/types.js';

/** Threshold for streaming file parsing (10MB) */
const STREAMING_THRESHOLD_BYTES = 10 * 1024 * 1024;

/**
 * Options for session ingestion.
 */
export interface IngestOptions {
  /** Maximum tokens per chunk. Default: 4096. */
  maxTokensPerChunk?: number;
  /** Include thinking blocks. Default: true. */
  includeThinking?: boolean;
  /** Embedding model ID. Default: 'jina-small'. */
  embeddingModel?: string;
  /** Skip if already ingested. Default: true. */
  skipIfExists?: boolean;
  /** Create cross-session edges. Default: true. */
  linkCrossSessions?: boolean;
  /** Shared embedder instance (for batch processing). */
  embedder?: Embedder;
  /** Process sub-agents. Default: true. */
  processSubAgents?: boolean;
  /** Use incremental ingestion (resume from checkpoints). Default: true. */
  useIncrementalIngestion?: boolean;
  /** Use embedding cache. Default: true. */
  useEmbeddingCache?: boolean;
  /** Override embedding device ('auto' | 'coreml' | 'cuda' | 'cpu' | 'wasm'). */
  embeddingDevice?: string;
}

/**
 * Result of session ingestion.
 */
export interface IngestResult {
  /** Session ID */
  sessionId: string;
  /** Session slug */
  sessionSlug: string;
  /** Number of chunks created */
  chunkCount: number;
  /** Number of edges created */
  edgeCount: number;
  /** Number of cross-session edges created */
  crossSessionEdges: number;
  /** Number of brief/debrief edges created */
  subAgentEdges: number;
  /** Whether session was skipped (already existed) */
  skipped: boolean;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Number of sub-agents processed */
  subAgentCount: number;
  /** Number of embedding cache hits */
  cacheHits?: number;
  /** Number of embedding cache misses */
  cacheMisses?: number;
  /** Reason for skip if skipped */
  skipReason?: 'already_ingested' | 'unchanged_file' | 'no_new_turns';
}

/**
 * Ingest a single session file.
 */
export async function ingestSession(
  sessionPath: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const startTime = Date.now();

  const {
    maxTokensPerChunk = 4096,
    includeThinking = true,
    embeddingModel = 'jina-small',
    skipIfExists = true,
    linkCrossSessions = true,
    processSubAgents = true,
    useIncrementalIngestion = true,
    useEmbeddingCache = true,
    embeddingDevice,
  } = options;

  // Get session info
  const info = await getSessionInfo(sessionPath);
  const projectSlug = deriveProjectSlug(info);
  const projectPath = info.cwd || '';

  // Get file stats for mtime check
  const fileStats = await stat(sessionPath);
  const fileMtime = fileStats.mtime.toISOString();

  // Check for checkpoint (incremental ingestion)
  const checkpoint = useIncrementalIngestion ? getCheckpoint(info.sessionId) : null;

  // Check if file is unchanged since last ingest (mtime skip)
  if (checkpoint && checkpoint.fileMtime) {
    const lastIngestMtime = new Date(checkpoint.fileMtime);
    if (fileStats.mtime <= lastIngestMtime) {
      return {
        sessionId: info.sessionId,
        sessionSlug: projectSlug,
        chunkCount: 0,
        edgeCount: 0,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: true,
        skipReason: 'unchanged_file',
        durationMs: Date.now() - startTime,
        subAgentCount: 0,
      };
    }
  }

  // Check if already ingested (only if no checkpoint - checkpoint means we might resume)
  if (skipIfExists && !checkpoint && isSessionIngested(info.sessionId)) {
    return {
      sessionId: info.sessionId,
      sessionSlug: projectSlug,
      chunkCount: 0,
      edgeCount: 0,
      crossSessionEdges: 0,
      subAgentEdges: 0,
      skipped: true,
      skipReason: 'already_ingested',
      durationMs: Date.now() - startTime,
      subAgentCount: 0,
    };
  }

  // Use streaming for large files
  const useStreaming = fileStats.size > STREAMING_THRESHOLD_BYTES;

  // Parse main session (sidechains filtered at message level)
  // Include noise (progress messages) to get agent_progress for brief/debrief detection
  let turns: Turn[];
  if (useStreaming) {
    const messageStream = streamSessionMessages(sessionPath, {
      includeSidechains: false,
      includeNoise: true,
    });
    turns = await assembleTurnsFromStream(messageStream);
  } else {
    const messages = await readSessionMessages(sessionPath, {
      includeSidechains: false,
      includeNoise: true,
    });
    turns = assembleTurns(messages);
  }

  // Calculate start turn for incremental ingestion
  const startTurnIndex = checkpoint ? checkpoint.lastTurnIndex + 1 : 0;
  const turnsToProcess = turns.slice(startTurnIndex);

  if (turnsToProcess.length === 0) {
    // Update checkpoint mtime even if no new turns
    if (checkpoint) {
      saveCheckpoint({
        ...checkpoint,
        fileMtime,
      });
    }
    return {
      sessionId: info.sessionId,
      sessionSlug: projectSlug,
      chunkCount: 0,
      edgeCount: 0,
      crossSessionEdges: 0,
      subAgentEdges: 0,
      skipped: startTurnIndex > 0,
      skipReason: startTurnIndex > 0 ? 'no_new_turns' : undefined,
      durationMs: Date.now() - startTime,
      subAgentCount: 0,
    };
  }

  // Set up embedding — single embedder, sequential inference
  const embedder = options.embedder ?? new Embedder();
  const needsDispose = !options.embedder;

  const embedAllFn = async (texts: string[]): Promise<number[][]> => {
    const results: number[][] = [];
    for (const t of texts) {
      const r = await embedder.embed(t, false);
      results.push(r.embedding);
    }
    return results;
  };

  // Track cache stats
  let totalCacheHits = 0;
  let totalCacheMisses = 0;

  try {
    // Load model if using a local embedder (pool workers load their own)
    if (embedder && (!embedder.currentModel || embedder.currentModel.id !== embeddingModel)) {
      await embedder.load(getModel(embeddingModel), { device: embeddingDevice });
    }

    // Track all chunks and sub-agent data
    let totalChunkCount = 0;
    let totalEdgeCount = 0;
    let subAgentEdges = 0;
    const subAgentData = new Map<string, { turns: Turn[]; chunks: Chunk[] }>();

    // 1. Discover and process sub-agents first (if enabled)
    let subAgentInfos: SubAgentInfo[] = [];
    if (processSubAgents) {
      subAgentInfos = await discoverSubAgents(sessionPath);

      for (const subAgent of subAgentInfos) {
        // Parse sub-agent session
        const subMessages = await readSessionMessages(subAgent.filePath, {
          includeSidechains: true,
        });
        const subTurns = assembleTurns(subMessages);

        if (subTurns.length === 0) continue;

        // Chunk sub-agent turns
        const subChunks = chunkTurns(subTurns, {
          maxTokens: maxTokensPerChunk,
          includeThinking,
          sessionId: info.sessionId,
          sessionSlug: projectSlug,
        });

        if (subChunks.length === 0) continue;

        // Store sub-agent chunks
        const subChunkInputs = subChunks.map((chunk) => ({ ...chunkToInput(chunk), projectPath }));
        const subChunkIds = insertChunks(subChunkInputs);

        // Embed with caching and true batch embedding
        const {
          embeddings: subEmbeddings,
          cacheHits,
          cacheMisses,
        } = await embedChunksWithCache(subChunks, embedAllFn, embeddingModel, useEmbeddingCache);
        totalCacheHits += cacheHits;
        totalCacheMisses += cacheMisses;

        await vectorStore.insertBatch(
          subChunkIds.map((id, i) => ({
            id,
            embedding: subEmbeddings[i],
          })),
        );

        // Create intra-agent edges
        const subTransitions = detectCausalTransitions(subChunks);
        const subEdgeResult = await createEdgesFromTransitions(subTransitions, subChunkIds);

        totalChunkCount += subChunkIds.length;
        totalEdgeCount += subEdgeResult.totalCount;

        // Store for brief/debrief detection
        subAgentData.set(subAgent.agentId, {
          turns: subTurns,
          chunks: subChunks.map((c, i) => ({ ...c, id: subChunkIds[i] })),
        });
      }
    }

    // 2. Chunk main session (only new turns)
    const mainChunks = chunkTurns(turnsToProcess, {
      maxTokens: maxTokensPerChunk,
      includeThinking,
      sessionId: info.sessionId,
      sessionSlug: projectSlug,
    });

    if (mainChunks.length === 0) {
      return {
        sessionId: info.sessionId,
        sessionSlug: projectSlug,
        chunkCount: totalChunkCount,
        edgeCount: totalEdgeCount,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: false,
        durationMs: Date.now() - startTime,
        subAgentCount: subAgentInfos.length,
        cacheHits: totalCacheHits,
        cacheMisses: totalCacheMisses,
      };
    }

    // Store main chunks
    const mainChunkInputs = mainChunks.map((chunk) => ({ ...chunkToInput(chunk), projectPath }));
    const mainChunkIds = insertChunks(mainChunkInputs);

    // Embed with caching and true batch embedding
    const {
      embeddings: mainEmbeddings,
      cacheHits,
      cacheMisses,
    } = await embedChunksWithCache(mainChunks, embedAllFn, embeddingModel, useEmbeddingCache);
    totalCacheHits += cacheHits;
    totalCacheMisses += cacheMisses;

    await vectorStore.insertBatch(
      mainChunkIds.map((id, i) => ({
        id,
        embedding: mainEmbeddings[i],
      })),
    );

    // Create main intra-session edges (sequential linked-list)
    const mainTransitions = detectCausalTransitions(mainChunks);
    const mainEdgeResult = await createEdgesFromTransitions(mainTransitions, mainChunkIds);

    totalChunkCount += mainChunkIds.length;
    totalEdgeCount += mainEdgeResult.totalCount;

    // 3. Detect and create brief/debrief edges
    if (processSubAgents && subAgentData.size > 0) {
      // Build chunk ID lookup by turn
      const chunkIdsByTurn = buildChunkIdsByTurn(
        mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] })),
      );

      // Detect brief points (spawns)
      const briefPoints = detectBriefPoints(turnsToProcess, chunkIdsByTurn, undefined, 0);

      // Create brief edges (single: last parent chunk → first sub-agent chunk)
      for (const brief of briefPoints) {
        const subData = subAgentData.get(brief.agentId);
        if (subData && subData.chunks.length > 0) {
          const lastParentChunkId = brief.parentChunkIds[brief.parentChunkIds.length - 1];
          const firstSubAgentChunkId = subData.chunks[0].id;

          await createBriefEdge(lastParentChunkId, firstSubAgentChunkId);
          subAgentEdges += 1;
        }
      }

      // Detect debrief points (returns)
      const debriefPoints = detectDebriefPoints(
        turnsToProcess,
        new Map(Array.from(subAgentData.entries()).map(([k, v]) => [k, v.chunks])),
        mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] })),
        chunkIdsByTurn,
        undefined,
        1,
      );

      // Create debrief edges (single: last sub-agent chunk → first parent chunk after return)
      for (const debrief of debriefPoints) {
        const lastAgentChunkId =
          debrief.agentFinalChunkIds[debrief.agentFinalChunkIds.length - 1];
        const firstParentChunkId = debrief.parentChunkIds[0];

        await createDebriefEdge(lastAgentChunkId, firstParentChunkId);
        subAgentEdges += 1;
      }
    }

    // 4. Save checkpoint for incremental ingestion
    if (useIncrementalIngestion) {
      saveCheckpoint({
        sessionId: info.sessionId,
        projectSlug,
        lastTurnIndex: startTurnIndex + turnsToProcess.length - 1,
        lastChunkId: mainChunkIds[mainChunkIds.length - 1],
        fileMtime,
      });
    }

    // 5. Link cross-sessions if requested
    let crossSessionEdges = 0;
    if (linkCrossSessions) {
      const linkResult = await linkCrossSession(info.sessionId, projectSlug);
      crossSessionEdges = linkResult.edgeCount;
    }

    return {
      sessionId: info.sessionId,
      sessionSlug: projectSlug,
      chunkCount: totalChunkCount,
      edgeCount: totalEdgeCount,
      crossSessionEdges,
      subAgentEdges,
      skipped: false,
      durationMs: Date.now() - startTime,
      subAgentCount: subAgentInfos.length,
      cacheHits: totalCacheHits,
      cacheMisses: totalCacheMisses,
    };
  } finally {
    if (needsDispose && embedder) {
      await embedder.dispose();
    }
  }
}

/**
 * Embed chunks with optional content-hash caching.
 *
 * Accepts an `embedAllFn` that abstracts the actual inference strategy:
 * - With a worker pool: texts are distributed across CPU cores in parallel
 * - Without: texts are embedded sequentially on the main thread
 *
 * The cache layer gives the biggest win on re-ingest — cached embeddings are
 * returned instantly from SQLite without any inference.
 */
async function embedChunksWithCache(
  chunks: Chunk[],
  embedAllFn: (texts: string[]) => Promise<number[][]>,
  modelId: string,
  useCache: boolean,
): Promise<{ embeddings: number[][]; cacheHits: number; cacheMisses: number }> {
  if (chunks.length === 0) {
    return { embeddings: [], cacheHits: 0, cacheMisses: 0 };
  }

  const texts = chunks.map((c) => c.text);
  const embeddings: number[][] = new Array(chunks.length);

  if (!useCache) {
    const results = await embedAllFn(texts);
    for (let i = 0; i < results.length; i++) {
      embeddings[i] = results[i];
    }
    return { embeddings, cacheHits: 0, cacheMisses: texts.length };
  }

  // Compute content hashes for all chunks
  const contentHashes = texts.map((t) => computeContentHash(t));

  // Check cache for existing embeddings
  const cachedEmbeddings = getCachedEmbeddingsBatch(contentHashes, modelId);

  // Separate cached vs uncached
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const cached = cachedEmbeddings.get(contentHashes[i]);
    if (cached) {
      embeddings[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  const cacheHits = cachedEmbeddings.size;
  const cacheMisses = uncachedIndices.length;

  // Embed uncached chunks (parallel if pool, sequential if embedder)
  if (uncachedTexts.length > 0) {
    const newEmbeddings = await embedAllFn(uncachedTexts);
    const toCache: Array<{ contentHash: string; embedding: number[] }> = [];

    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      embeddings[i] = newEmbeddings[j];
      toCache.push({
        contentHash: contentHashes[i],
        embedding: newEmbeddings[j],
      });
    }

    // Cache new embeddings
    cacheEmbeddingsBatch(toCache, modelId);
  }

  return { embeddings, cacheHits, cacheMisses };
}

/**
 * Convert parser Chunk to storage ChunkInput.
 */
export function chunkToInput(chunk: Chunk): ChunkInput {
  return {
    id: chunk.id,
    sessionId: chunk.metadata.sessionId,
    sessionSlug: chunk.metadata.sessionSlug,
    turnIndices: chunk.metadata.turnIndices,
    startTime: chunk.metadata.startTime,
    endTime: chunk.metadata.endTime,
    content: chunk.text,
    codeBlockCount: chunk.metadata.codeBlockCount,
    toolUseCount: chunk.metadata.toolUseCount,
    approxTokens: chunk.metadata.approxTokens,
  };
}
