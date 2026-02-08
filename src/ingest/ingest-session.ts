/**
 * Session ingestion orchestrator.
 * Parses, chunks, embeds, and stores a single session.
 * Supports sub-agent discovery and vector clock tracking.
 */

import {
  readSessionMessages,
  getSessionInfo,
  discoverSubAgents,
  type SubAgentInfo,
} from '../parser/session-reader.js';
import { assembleTurns } from '../parser/turn-assembler.js';
import {
  chunkTurns,
  chunkTurnsWithClock,
  resetChunkCounter,
  type ChunkWithClock,
  type ChunkMetadataWithClock,
} from '../parser/chunker.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { insertChunks, isSessionIngested } from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { detectTransitions } from './edge-detector.js';
import {
  createEdgesFromTransitions,
  createBriefEdges,
  createDebriefEdges,
} from './edge-creator.js';
import { linkCrossSession } from './cross-session-linker.js';
import {
  detectBriefPoints,
  detectDebriefPoints,
  buildChunkIdsByTurn,
} from './brief-debrief-detector.js';
import {
  getAgentClock,
  updateAgentClock,
  getReferenceClock,
} from '../storage/clock-store.js';
import {
  type VectorClock,
  merge,
  MAIN_AGENT_ID,
} from '../temporal/vector-clock.js';
import type { ChunkInput } from '../storage/types.js';
import type { Chunk, Turn } from '../parser/types.js';

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
  /** Use vector clocks. Default: true. */
  useVectorClocks?: boolean;
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
}

/**
 * Ingest a single session file.
 */
export async function ingestSession(
  sessionPath: string,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const startTime = Date.now();

  const {
    maxTokensPerChunk = 4096,
    includeThinking = true,
    embeddingModel = 'jina-small',
    skipIfExists = true,
    linkCrossSessions = true,
    processSubAgents = true,
    useVectorClocks = true,
  } = options;

  // Get session info
  const info = await getSessionInfo(sessionPath);
  const projectSlug = info.slug;

  // Check if already ingested
  if (skipIfExists && isSessionIngested(info.sessionId)) {
    return {
      sessionId: info.sessionId,
      sessionSlug: info.slug,
      chunkCount: 0,
      edgeCount: 0,
      crossSessionEdges: 0,
      subAgentEdges: 0,
      skipped: true,
      durationMs: Date.now() - startTime,
      subAgentCount: 0,
    };
  }

  // Parse main session (sidechains filtered at message level)
  // Include noise (progress messages) to get agent_progress for brief/debrief detection
  const messages = await readSessionMessages(sessionPath, { includeSidechains: false, includeNoise: true });
  const turns = assembleTurns(messages);

  if (turns.length === 0) {
    return {
      sessionId: info.sessionId,
      sessionSlug: info.slug,
      chunkCount: 0,
      edgeCount: 0,
      crossSessionEdges: 0,
      subAgentEdges: 0,
      skipped: false,
      durationMs: Date.now() - startTime,
      subAgentCount: 0,
    };
  }

  // Set up embedder
  const embedder = options.embedder ?? new Embedder();
  const needsDispose = !options.embedder;

  try {
    await embedder.load(getModel(embeddingModel));

    // Get initial clock state for this project
    let mainClock = useVectorClocks ? getAgentClock(projectSlug, MAIN_AGENT_ID) : {};

    // Track all chunks and sub-agent data
    let totalChunkCount = 0;
    let totalEdgeCount = 0;
    let subAgentEdges = 0;
    const subAgentData = new Map<string, { turns: Turn[]; chunks: ChunkWithClock[] }>();

    // 1. Discover and process sub-agents first (if enabled)
    let subAgentInfos: SubAgentInfo[] = [];
    if (processSubAgents) {
      subAgentInfos = await discoverSubAgents(sessionPath);

      for (const subAgent of subAgentInfos) {
        // Initialize sub-agent clock by merging parent context
        let subClock = useVectorClocks
          ? merge(getAgentClock(projectSlug, MAIN_AGENT_ID), { [subAgent.agentId]: 0 })
          : {};

        // Parse sub-agent session
        const subMessages = await readSessionMessages(subAgent.filePath, { includeSidechains: true });
        const subTurns = assembleTurns(subMessages);

        if (subTurns.length === 0) continue;

        // Chunk with clock tracking
        const subChunks = useVectorClocks
          ? chunkTurnsWithClock(subTurns, {
              maxTokens: maxTokensPerChunk,
              includeThinking,
              sessionId: info.sessionId,
              sessionSlug: info.slug,
              agentId: subAgent.agentId,
              initialClock: subClock,
              onTick: (c) => { subClock = c; },
              spawnDepth: 1,
            })
          : chunkTurns(subTurns, {
              maxTokens: maxTokensPerChunk,
              includeThinking,
              sessionId: info.sessionId,
              sessionSlug: info.slug,
            }).map(c => c as ChunkWithClock);

        if (subChunks.length === 0) continue;

        // Store sub-agent chunks
        const subChunkInputs = subChunks.map((chunk) => chunkWithClockToInput(chunk));
        const subChunkIds = insertChunks(subChunkInputs);

        // Embed and store
        const subEmbeddings: number[][] = [];
        for (const chunk of subChunks) {
          const result = await embedder.embed(chunk.text, true);
          subEmbeddings.push(result.embedding);
        }

        await vectorStore.insertBatch(
          subChunkIds.map((id, i) => ({
            id,
            embedding: subEmbeddings[i],
          }))
        );

        // Create intra-agent edges
        const subTransitions = detectTransitions(subChunks);
        const subEdgeResult = await createEdgesFromTransitions(
          subTransitions,
          subChunkIds,
          { vectorClock: subClock, useBoostMode: true }
        );

        totalChunkCount += subChunkIds.length;
        totalEdgeCount += subEdgeResult.totalCount;

        // Update sub-agent clock
        if (useVectorClocks) {
          updateAgentClock(projectSlug, subAgent.agentId, subClock);
        }

        // Store for brief/debrief detection
        subAgentData.set(subAgent.agentId, {
          turns: subTurns,
          chunks: subChunks.map((c, i) => ({ ...c, id: subChunkIds[i] })),
        });
      }
    }

    // 2. Chunk main session with clock tracking
    const mainChunks = useVectorClocks
      ? chunkTurnsWithClock(turns, {
          maxTokens: maxTokensPerChunk,
          includeThinking,
          sessionId: info.sessionId,
          sessionSlug: info.slug,
          agentId: MAIN_AGENT_ID,
          initialClock: mainClock,
          onTick: (c) => { mainClock = c; },
          spawnDepth: 0,
        })
      : chunkTurns(turns, {
          maxTokens: maxTokensPerChunk,
          includeThinking,
          sessionId: info.sessionId,
          sessionSlug: info.slug,
        }).map(c => c as ChunkWithClock);

    if (mainChunks.length === 0) {
      return {
        sessionId: info.sessionId,
        sessionSlug: info.slug,
        chunkCount: totalChunkCount,
        edgeCount: totalEdgeCount,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        skipped: false,
        durationMs: Date.now() - startTime,
        subAgentCount: subAgentInfos.length,
      };
    }

    // Store main chunks
    const mainChunkInputs = mainChunks.map((chunk) => chunkWithClockToInput(chunk));
    const mainChunkIds = insertChunks(mainChunkInputs);

    // Embed and store main chunks
    const mainEmbeddings: number[][] = [];
    for (const chunk of mainChunks) {
      const result = await embedder.embed(chunk.text, true);
      mainEmbeddings.push(result.embedding);
    }

    await vectorStore.insertBatch(
      mainChunkIds.map((id, i) => ({
        id,
        embedding: mainEmbeddings[i],
      }))
    );

    // Update main clock
    if (useVectorClocks) {
      updateAgentClock(projectSlug, MAIN_AGENT_ID, mainClock);
    }

    // Create main intra-session edges
    const mainTransitions = detectTransitions(mainChunks);
    const mainEdgeResult = await createEdgesFromTransitions(
      mainTransitions,
      mainChunkIds,
      { vectorClock: mainClock, useBoostMode: true }
    );

    totalChunkCount += mainChunkIds.length;
    totalEdgeCount += mainEdgeResult.totalCount;

    // 3. Detect and create brief/debrief edges
    if (processSubAgents && subAgentData.size > 0) {
      // Build chunk ID lookup by turn
      const chunkIdsByTurn = buildChunkIdsByTurn(
        mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] }))
      );

      // Detect brief points (spawns)
      const briefPoints = detectBriefPoints(turns, chunkIdsByTurn, mainClock, 0);

      // Create brief edges
      for (const brief of briefPoints) {
        const subData = subAgentData.get(brief.agentId);
        if (subData && subData.chunks.length > 0) {
          await createBriefEdges(
            brief.parentChunkId,
            subData.chunks[0].id,
            brief.clock,
            brief.spawnDepth
          );
          subAgentEdges += 2; // backward + forward
        }
      }

      // Detect debrief points (returns)
      const debriefPoints = detectDebriefPoints(
        turns,
        new Map(
          Array.from(subAgentData.entries()).map(([k, v]) => [k, v.chunks])
        ),
        mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] })),
        chunkIdsByTurn,
        mainClock,
        1
      );

      // Create debrief edges
      for (const debrief of debriefPoints) {
        await createDebriefEdges(
          debrief.agentFinalChunkIds,
          debrief.parentChunkId,
          debrief.clock,
          debrief.spawnDepth
        );
        subAgentEdges += debrief.agentFinalChunkIds.length * 2; // backward + forward per chunk
      }
    }

    // 4. Link cross-sessions if requested
    let crossSessionEdges = 0;
    if (linkCrossSessions) {
      const linkResult = await linkCrossSession(info.sessionId, info.slug);
      crossSessionEdges = linkResult.edgeCount;
    }

    return {
      sessionId: info.sessionId,
      sessionSlug: info.slug,
      chunkCount: totalChunkCount,
      edgeCount: totalEdgeCount,
      crossSessionEdges,
      subAgentEdges,
      skipped: false,
      durationMs: Date.now() - startTime,
      subAgentCount: subAgentInfos.length,
    };
  } finally {
    if (needsDispose) {
      await embedder.dispose();
    }
  }
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

/**
 * Convert parser ChunkWithClock to storage ChunkInput.
 */
export function chunkWithClockToInput(chunk: ChunkWithClock): ChunkInput {
  const meta = chunk.metadata as ChunkMetadataWithClock;
  return {
    id: chunk.id,
    sessionId: meta.sessionId,
    sessionSlug: meta.sessionSlug,
    turnIndices: meta.turnIndices,
    startTime: meta.startTime,
    endTime: meta.endTime,
    content: chunk.text,
    codeBlockCount: meta.codeBlockCount,
    toolUseCount: meta.toolUseCount,
    approxTokens: meta.approxTokens,
    agentId: meta.agentId,
    vectorClock: meta.vectorClock,
    spawnDepth: meta.spawnDepth,
  };
}
