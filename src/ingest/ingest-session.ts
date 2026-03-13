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
  createTeamEdges,
} from './edge-creator.js';
import { linkCrossSession } from './cross-session-linker.js';
import {
  detectBriefPoints,
  detectDebriefPoints,
  buildChunkIdsByTurn,
} from './brief-debrief-detector.js';
import { detectTeamTopology, groupTeammateFiles, type TeamTopology } from './team-detector.js';
import { detectTeamEdges } from './team-edge-detector.js';
import {
  getCheckpoint,
  saveCheckpoint,
  type IngestionCheckpoint,
} from '../storage/checkpoint-store.js';
import {
  computeContentHash,
  getCachedEmbeddingsBatch,
  cacheEmbeddingsBatch,
} from '../storage/embedding-cache.js';
import type { ChunkInput } from '../storage/types.js';
import type { Chunk, Turn, SessionInfo } from '../parser/types.js';
import { createLogger } from '../utils/logger.js';
import { resolveCanonicalProjectPath } from '../utils/project-path.js';
import { generateIndexEntriesForChunks } from './index-entry-hook.js';
import { extractSessionState } from './session-state.js';
import { extractEntities } from '../utils/entity-extractor.js';
import { upsertSessionState } from '../storage/session-state-store.js';
import { resolveEntity, insertEntityMention } from '../storage/entity-store.js';
import { loadConfig, toRuntimeConfig } from '../config/loader.js';

const log = createLogger('ingest-session');

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
  /** Number of team edges created */
  teamEdges: number;
  /** Number of dead-end sub-agent files skipped */
  deadEndFilesSkipped: number;
  /** Whether this session uses agent teams */
  isTeamSession: boolean;
}

/**
 * Create a result for a skipped or empty session.
 */
function createSkipResult(
  sessionId: string,
  sessionSlug: string,
  startTime: number,
  overrides: Partial<IngestResult> = {},
): IngestResult {
  return {
    sessionId,
    sessionSlug,
    chunkCount: 0,
    edgeCount: 0,
    crossSessionEdges: 0,
    subAgentEdges: 0,
    skipped: true,
    durationMs: Date.now() - startTime,
    subAgentCount: 0,
    teamEdges: 0,
    deadEndFilesSkipped: 0,
    isTeamSession: false,
    ...overrides,
  };
}

/** Result of validation and setup phase. */
interface SetupResult {
  info: SessionInfo;
  projectSlug: string;
  projectPath: string;
  sessionId: string;
  checkpoint: IngestionCheckpoint | null;
  fileMtime: string;
  useStreaming: boolean;
}

/**
 * Validate session and gather setup data.
 * Returns `{ skip }` for early exit or `{ setup }` to continue processing.
 */
async function validateAndSetup(
  sessionPath: string,
  options: IngestOptions,
  startTime: number,
): Promise<{ skip: IngestResult } | { setup: SetupResult }> {
  const { skipIfExists = true, useIncrementalIngestion = true } = options;

  // Get session info
  const info = await getSessionInfo(sessionPath);
  const projectSlug = deriveProjectSlug(info);
  const projectPath = info.cwd ? resolveCanonicalProjectPath(info.cwd) : '';

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
        skip: createSkipResult(info.sessionId, projectSlug, startTime, {
          skipReason: 'unchanged_file',
        }),
      };
    }
  }

  // Check if already ingested (only if no checkpoint - checkpoint means we might resume)
  if (skipIfExists && !checkpoint && isSessionIngested(info.sessionId)) {
    return {
      skip: createSkipResult(info.sessionId, projectSlug, startTime, {
        skipReason: 'already_ingested',
      }),
    };
  }

  // Use streaming for large files
  const useStreaming = fileStats.size > STREAMING_THRESHOLD_BYTES;

  return {
    setup: {
      info,
      projectSlug,
      projectPath,
      sessionId: info.sessionId,
      checkpoint,
      fileMtime,
      useStreaming,
    },
  };
}

/**
 * Parse session turns and apply incremental filtering.
 * Returns null if there are no new turns to process (with checkpoint mtime updated).
 */
async function assembleSessionTurns(
  sessionPath: string,
  setup: SetupResult,
  startTime: number,
): Promise<
  { allTurns: Turn[]; turnsToProcess: Turn[]; startTurnIndex: number } | { skip: IngestResult }
> {
  const { checkpoint, fileMtime, useStreaming, projectSlug, sessionId } = setup;

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
      skip: createSkipResult(sessionId, projectSlug, startTime, {
        skipped: startTurnIndex > 0,
        skipReason: startTurnIndex > 0 ? 'no_new_turns' : undefined,
      }),
    };
  }

  return { allTurns: turns, turnsToProcess, startTurnIndex };
}

/** Type for the embed-all function. */
type EmbedAllFn = (texts: string[]) => Promise<number[][]>;

/** Context for embedding operations. */
interface EmbeddingContext {
  embedder: Embedder | null;
  embedAllFn: EmbedAllFn;
  shouldEmbed: boolean;
  needsDispose: boolean;
}

/**
 * Initialize embedding context based on configuration.
 * Non-fatal — logs and disables embedding on error.
 */
async function initializeEmbedding(options: IngestOptions): Promise<EmbeddingContext> {
  const { embeddingModel = 'jina-small', embeddingDevice } = options;

  // Determine whether to embed chunks during ingestion
  const runtimeConfig = toRuntimeConfig(loadConfig());
  const shouldEmbed = runtimeConfig.embeddingEager;

  // Set up embedding — single embedder, sequential inference (only when eager)
  const embedder = shouldEmbed ? (options.embedder ?? new Embedder()) : null;
  const needsDispose = shouldEmbed && !options.embedder;

  const embedAllFn: EmbedAllFn = async (texts: string[]): Promise<number[][]> => {
    if (!embedder) return texts.map(() => []);
    const results: number[][] = [];
    for (const t of texts) {
      const r = await embedder.embed(t, false);
      results.push(r.embedding);
    }
    return results;
  };

  // Load model if using a local embedder (pool workers load their own)
  if (embedder && (!embedder.currentModel || embedder.currentModel.id !== embeddingModel)) {
    await embedder.load(getModel(embeddingModel), { device: embeddingDevice });
  }

  return { embedder, embedAllFn, shouldEmbed, needsDispose };
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
    linkCrossSessions = true,
    processSubAgents = true,
    useIncrementalIngestion = true,
    useEmbeddingCache = true,
  } = options;

  // Stage 1: Validate and setup
  const validated = await validateAndSetup(sessionPath, options, startTime);
  if ('skip' in validated) return validated.skip;
  const { setup } = validated;
  const { projectSlug, projectPath, sessionId, fileMtime } = setup;

  // Stage 2: Parse and filter turns
  const turnResult = await assembleSessionTurns(sessionPath, setup, startTime);
  if ('skip' in turnResult) return turnResult.skip;
  const { allTurns: turns, turnsToProcess, startTurnIndex } = turnResult;

  // Stage 3: Initialize embedding
  const embedding = await initializeEmbedding(options);
  const { embedAllFn, shouldEmbed } = embedding;

  // Track cache stats
  let totalCacheHits = 0;
  let totalCacheMisses = 0;

  try {
    // Track all chunks and sub-agent data
    let totalChunkCount = 0;
    let totalEdgeCount = 0;
    let deadEndFilesSkipped = 0;
    const subAgentData = new Map<string, { turns: Turn[]; chunks: Chunk[] }>();

    // Stage 4: Discover and process sub-agents (if enabled)
    let subAgentInfos: SubAgentInfo[] = [];
    if (processSubAgents) {
      subAgentInfos = await discoverSubAgents(sessionPath);

      // Filter out dead-end files
      const activeSubAgents: SubAgentInfo[] = [];
      for (const sa of subAgentInfos) {
        if (sa.isDeadEnd) {
          deadEndFilesSkipped++;
          log.debug('Skipping dead-end sub-agent file', {
            agentId: sa.agentId,
            lineCount: sa.lineCount,
          });
        } else {
          activeSubAgents.push(sa);
        }
      }

      // Detect team topology using ALL turns (not turnsToProcess — needs full history)
      const topology = detectTeamTopology(turns, activeSubAgents);

      if (topology.isTeamSession) {
        log.info('Detected team session', {
          teamName: topology.teamName,
          teammates: topology.teammates.size,
          teamAgentIds: topology.teamAgentIds.size,
        });

        // Partition sub-agents: team members vs regular sub-agents
        const regularSubAgents: SubAgentInfo[] = [];
        const teamSubAgents: SubAgentInfo[] = [];
        for (const sa of activeSubAgents) {
          if (topology.teamAgentIds.has(sa.agentId)) {
            teamSubAgents.push(sa);
          } else {
            regularSubAgents.push(sa);
          }
        }

        // Process regular sub-agents through existing brief/debrief pipeline
        for (const subAgent of regularSubAgents) {
          const result = await processSubAgent(
            subAgent,
            sessionId,
            projectSlug,
            projectPath,
            maxTokensPerChunk,
            includeThinking,
            embedAllFn,
            embeddingModel,
            useEmbeddingCache,
            shouldEmbed,
          );
          if (!result) continue;

          totalChunkCount += result.chunkCount;
          totalEdgeCount += result.edgeCount;
          totalCacheHits += result.cacheHits;
          totalCacheMisses += result.cacheMisses;
          subAgentData.set(subAgent.agentId, { turns: result.turns, chunks: result.chunks });
        }

        // Process team members: group by teammate name, then process each file
        const teammateGroups = groupTeammateFiles(teamSubAgents, topology);
        const teamAgentData = new Map<string, { turns: Turn[]; chunks: ChunkInput[] }>();

        for (const group of teammateGroups) {
          for (const subAgent of group.files) {
            const subMessages = await readSessionMessages(subAgent.filePath, {
              includeSidechains: true,
            });
            const subTurns = assembleTurns(subMessages);
            if (subTurns.length === 0) continue;

            const subChunks = chunkTurns(subTurns, {
              maxTokens: maxTokensPerChunk,
              includeThinking,
              sessionId,
              sessionSlug: projectSlug,
            });
            if (subChunks.length === 0) continue;

            // Store with human-readable agentId and teamName
            const subChunkInputs = subChunks.map((chunk) => ({
              ...chunkToInput(chunk),
              projectPath,
              agentId: group.humanName,
              teamName: topology.teamName ?? undefined,
            }));
            const subChunkIds = insertChunks(subChunkInputs);

            // Embed (only when eager embedding is enabled)
            if (shouldEmbed) {
              const {
                embeddings: subEmbeddings,
                cacheHits: ch,
                cacheMisses: cm,
              } = await embedChunksWithCache(
                subChunks,
                embedAllFn,
                embeddingModel,
                useEmbeddingCache,
              );
              totalCacheHits += ch;
              totalCacheMisses += cm;

              await vectorStore.insertBatch(
                subChunkIds.map((id, i) => ({ id, embedding: subEmbeddings[i] })),
              );
            }

            // Create within-chain edges
            const subTransitions = detectCausalTransitions(subChunks);
            const subEdgeResult = await createEdgesFromTransitions(subTransitions, subChunkIds);

            totalChunkCount += subChunkIds.length;
            totalEdgeCount += subEdgeResult.totalCount;

            // Store for team edge detection (use ChunkInput with IDs)
            const chunkInputsWithIds = subChunkInputs.map((c, i) => ({ ...c, id: subChunkIds[i] }));
            const existing = teamAgentData.get(group.humanName);
            if (existing) {
              existing.turns.push(...subTurns);
              existing.chunks.push(...chunkInputsWithIds);
            } else {
              teamAgentData.set(group.humanName, {
                turns: subTurns,
                chunks: chunkInputsWithIds,
              });
            }
          }
        }

        // Process main session (shared pipeline)
        const mainResult = await processMainSession({
          turnsToProcess,
          allTurns: turns,
          sessionId,
          projectSlug,
          projectPath,
          maxTokensPerChunk,
          includeThinking,
          embedAllFn,
          embeddingModel,
          useEmbeddingCache,
          useIncrementalIngestion,
          linkCrossSessions,
          startTurnIndex,
          fileMtime,
          subAgentData,
          team: { topology, agentData: teamAgentData },
          shouldEmbed,
        });

        totalChunkCount += mainResult?.chunkCount ?? 0;
        totalEdgeCount += mainResult?.edgeCount ?? 0;
        totalCacheHits += mainResult?.cacheHits ?? 0;
        totalCacheMisses += mainResult?.cacheMisses ?? 0;

        // Extract and store session state
        saveSessionState(turns, sessionId, projectSlug, projectPath);

        return {
          sessionId,
          sessionSlug: projectSlug,
          chunkCount: totalChunkCount,
          edgeCount: totalEdgeCount,
          crossSessionEdges: mainResult?.crossSessionEdges ?? 0,
          subAgentEdges: mainResult?.subAgentEdges ?? 0,
          skipped: false,
          durationMs: Date.now() - startTime,
          subAgentCount: subAgentInfos.length,
          cacheHits: totalCacheHits,
          cacheMisses: totalCacheMisses,
          teamEdges: mainResult?.teamEdges ?? 0,
          deadEndFilesSkipped,
          isTeamSession: true,
        };
      }

      // Non-team session: process all active sub-agents through existing pipeline
      for (const subAgent of activeSubAgents) {
        const result = await processSubAgent(
          subAgent,
          sessionId,
          projectSlug,
          projectPath,
          maxTokensPerChunk,
          includeThinking,
          embedAllFn,
          embeddingModel,
          useEmbeddingCache,
          shouldEmbed,
        );
        if (!result) continue;

        totalChunkCount += result.chunkCount;
        totalEdgeCount += result.edgeCount;
        totalCacheHits += result.cacheHits;
        totalCacheMisses += result.cacheMisses;
        subAgentData.set(subAgent.agentId, { turns: result.turns, chunks: result.chunks });
      }
    }

    // Stage 5: Process main session (shared pipeline)
    const mainResult = await processMainSession({
      turnsToProcess,
      allTurns: turns,
      sessionId,
      projectSlug,
      projectPath,
      maxTokensPerChunk,
      includeThinking,
      embedAllFn,
      embeddingModel,
      useEmbeddingCache,
      useIncrementalIngestion,
      linkCrossSessions,
      startTurnIndex,
      fileMtime,
      subAgentData,
      team: null,
      shouldEmbed,
    });

    totalChunkCount += mainResult?.chunkCount ?? 0;
    totalEdgeCount += mainResult?.edgeCount ?? 0;
    totalCacheHits += mainResult?.cacheHits ?? 0;
    totalCacheMisses += mainResult?.cacheMisses ?? 0;

    // Extract and store session state
    saveSessionState(turns, sessionId, projectSlug, projectPath);

    return {
      sessionId,
      sessionSlug: projectSlug,
      chunkCount: totalChunkCount,
      edgeCount: totalEdgeCount,
      crossSessionEdges: mainResult?.crossSessionEdges ?? 0,
      subAgentEdges: mainResult?.subAgentEdges ?? 0,
      skipped: false,
      durationMs: Date.now() - startTime,
      subAgentCount: subAgentInfos.length,
      cacheHits: totalCacheHits,
      cacheMisses: totalCacheMisses,
      teamEdges: 0,
      deadEndFilesSkipped,
      isTeamSession: false,
    };
  } finally {
    if (embedding.needsDispose && embedding.embedder) {
      await embedding.embedder.dispose();
    }
  }
}

/** Parameters for the shared main session processing pipeline. */
interface MainSessionParams {
  turnsToProcess: Turn[];
  allTurns: Turn[];
  sessionId: string;
  projectSlug: string;
  projectPath: string;
  maxTokensPerChunk: number;
  includeThinking: boolean;
  embedAllFn: (texts: string[]) => Promise<number[][]>;
  embeddingModel: string;
  useEmbeddingCache: boolean;
  useIncrementalIngestion: boolean;
  linkCrossSessions: boolean;
  startTurnIndex: number;
  fileMtime: string;
  subAgentData: Map<string, { turns: Turn[]; chunks: Chunk[] }>;
  /** Team-specific data (null for non-team sessions). */
  team: {
    topology: TeamTopology;
    agentData: Map<string, { turns: Turn[]; chunks: ChunkInput[] }>;
  } | null;
  /** Whether to embed chunks and store vectors. Default: true for backward compat. */
  shouldEmbed?: boolean;
}

/** Result from processMainSession. */
interface MainSessionResult {
  chunkCount: number;
  edgeCount: number;
  crossSessionEdges: number;
  subAgentEdges: number;
  teamEdges: number;
  cacheHits: number;
  cacheMisses: number;
  mainChunkIds: string[];
}

/**
 * Shared pipeline for processing the main session chunks.
 * Handles: chunk → store → embed → edges → brief/debrief → team edges → checkpoint → cross-session.
 * Returns null if no chunks were produced.
 */
async function processMainSession(params: MainSessionParams): Promise<MainSessionResult | null> {
  const {
    turnsToProcess,
    allTurns,
    sessionId,
    projectSlug,
    projectPath,
    maxTokensPerChunk,
    includeThinking,
    embedAllFn,
    embeddingModel,
    useEmbeddingCache,
    useIncrementalIngestion,
    linkCrossSessions,
    startTurnIndex,
    fileMtime,
    subAgentData,
    team,
    shouldEmbed = true,
  } = params;

  // Chunk main session (only new turns)
  const mainChunks = chunkTurns(turnsToProcess, {
    maxTokens: maxTokensPerChunk,
    includeThinking,
    sessionId,
    sessionSlug: projectSlug,
  });

  if (mainChunks.length === 0) {
    return null;
  }

  // Store main chunks
  const mainChunkInputs = mainChunks.map((chunk) => ({
    ...chunkToInput(chunk),
    projectPath,
  }));
  const mainChunkIds = insertChunks(mainChunkInputs);

  // Embed main chunks (only when eager embedding is enabled)
  let cacheHits = 0;
  let cacheMisses = 0;

  if (shouldEmbed) {
    const embedResult = await embedChunksWithCache(
      mainChunks,
      embedAllFn,
      embeddingModel,
      useEmbeddingCache,
    );
    cacheHits = embedResult.cacheHits;
    cacheMisses = embedResult.cacheMisses;

    await vectorStore.insertBatch(
      mainChunkIds.map((id, i) => ({ id, embedding: embedResult.embeddings[i] })),
    );

    // Generate semantic index entries for the new chunks
    await generateIndexEntriesForChunks(
      mainChunks.map((c, i) => ({
        id: mainChunkIds[i],
        sessionSlug: projectSlug,
        startTime: c.metadata.startTime,
        content: c.text,
        approxTokens: c.metadata.approxTokens,
      })),
      projectSlug,
      embedResult.embeddings,
      mainChunkIds,
      embeddingModel,
    );
  }

  // Create main intra-session edges
  const mainTransitions = detectCausalTransitions(mainChunks);
  const mainEdgeResult = await createEdgesFromTransitions(mainTransitions, mainChunkIds);
  let totalEdgeCount = mainEdgeResult.totalCount;
  let subAgentEdges = 0;
  let teamEdgeCount = 0;

  // Brief/debrief edges
  if (subAgentData.size > 0) {
    const chunkIdsByTurn = buildChunkIdsByTurn(
      mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] })),
    );

    const briefPoints = detectBriefPoints(turnsToProcess, chunkIdsByTurn, undefined, 0);
    for (const brief of briefPoints) {
      const subData = subAgentData.get(brief.agentId);
      if (subData && subData.chunks.length > 0) {
        const lastParentChunkId = brief.parentChunkIds[brief.parentChunkIds.length - 1];
        const firstSubAgentChunkId = subData.chunks[0].id;
        await createBriefEdge(lastParentChunkId, firstSubAgentChunkId);
        subAgentEdges += 1;
      }
    }

    const debriefPoints = detectDebriefPoints(
      turnsToProcess,
      new Map(Array.from(subAgentData.entries()).map(([k, v]) => [k, v.chunks])),
      mainChunks.map((c, i) => ({ ...c, id: mainChunkIds[i] })),
      chunkIdsByTurn,
      undefined,
      1,
    );
    for (const debrief of debriefPoints) {
      const lastAgentChunkId = debrief.agentFinalChunkIds[debrief.agentFinalChunkIds.length - 1];
      const firstParentChunkId = debrief.parentChunkIds[0];
      await createDebriefEdge(lastAgentChunkId, firstParentChunkId);
      subAgentEdges += 1;
    }
  }

  // Entity extraction (best-effort, non-blocking)
  try {
    saveEntityMentions(
      mainChunks.map((c, i) => ({ id: mainChunkIds[i], content: c.text })),
      projectSlug,
    );
  } catch (error) {
    log.warn('Failed to extract entities', { error: String(error) });
  }

  // Team edges (team sessions only)
  if (team && team.agentData.size > 0) {
    const mainChunkInputsForEdges = mainChunks.map((c, i) => ({
      ...chunkToInput(c),
      projectPath,
      id: mainChunkIds[i],
    }));

    const teamEdgePoints = detectTeamEdges(
      allTurns, // Use ALL turns for detection
      mainChunkInputsForEdges,
      team.agentData,
      team.topology,
    );

    teamEdgeCount = await createTeamEdges(teamEdgePoints);
    totalEdgeCount += teamEdgeCount;
  }

  // Save checkpoint
  if (useIncrementalIngestion) {
    saveCheckpoint({
      sessionId,
      projectSlug,
      lastTurnIndex: startTurnIndex + turnsToProcess.length - 1,
      lastChunkId: mainChunkIds[mainChunkIds.length - 1],
      fileMtime,
    });
  }

  // Link cross-sessions
  let crossSessionEdges = 0;
  if (linkCrossSessions) {
    const linkResult = await linkCrossSession(sessionId, projectSlug);
    crossSessionEdges = linkResult.edgeCount;
  }

  return {
    chunkCount: mainChunkIds.length,
    edgeCount: totalEdgeCount,
    crossSessionEdges,
    subAgentEdges,
    teamEdges: teamEdgeCount,
    cacheHits,
    cacheMisses,
    mainChunkIds,
  };
}

/**
 * Extract and store entity mentions from chunks. Best-effort — failures are logged but don't block ingestion.
 */
function saveEntityMentions(
  chunks: Array<{ id: string; content: string }>,
  projectSlug: string,
): void {
  for (const chunk of chunks) {
    const mentions = extractEntities(chunk.content);
    for (const mention of mentions) {
      const entityId = resolveEntity(
        mention.normalizedName,
        mention.entityType,
        mention.mentionForm,
        projectSlug,
      );
      insertEntityMention(chunk.id, entityId, mention.mentionForm, mention.confidence);
    }
  }
}

/**
 * Process a single sub-agent file: parse, chunk, embed, store, create edges.
 * Extracted to reduce duplication between team and non-team paths.
 */
async function processSubAgent(
  subAgent: SubAgentInfo,
  sessionId: string,
  sessionSlug: string,
  projectPath: string,
  maxTokensPerChunk: number,
  includeThinking: boolean,
  embedAllFn: (texts: string[]) => Promise<number[][]>,
  embeddingModel: string,
  useEmbeddingCache: boolean,
  shouldEmbed = true,
): Promise<{
  turns: Turn[];
  chunks: Chunk[];
  chunkCount: number;
  edgeCount: number;
  cacheHits: number;
  cacheMisses: number;
} | null> {
  const subMessages = await readSessionMessages(subAgent.filePath, {
    includeSidechains: true,
  });
  const subTurns = assembleTurns(subMessages);
  if (subTurns.length === 0) return null;

  const subChunks = chunkTurns(subTurns, {
    maxTokens: maxTokensPerChunk,
    includeThinking,
    sessionId,
    sessionSlug,
  });
  if (subChunks.length === 0) return null;

  const subChunkInputs = subChunks.map((chunk) => ({ ...chunkToInput(chunk), projectPath }));
  const subChunkIds = insertChunks(subChunkInputs);

  let cacheHits = 0;
  let cacheMisses = 0;

  if (shouldEmbed) {
    const embedResult = await embedChunksWithCache(
      subChunks,
      embedAllFn,
      embeddingModel,
      useEmbeddingCache,
    );
    cacheHits = embedResult.cacheHits;
    cacheMisses = embedResult.cacheMisses;

    await vectorStore.insertBatch(
      subChunkIds.map((id, i) => ({ id, embedding: embedResult.embeddings[i] })),
    );
  }

  const subTransitions = detectCausalTransitions(subChunks);
  const subEdgeResult = await createEdgesFromTransitions(subTransitions, subChunkIds);

  return {
    turns: subTurns,
    chunks: subChunks.map((c, i) => ({ ...c, id: subChunkIds[i] })),
    chunkCount: subChunkIds.length,
    edgeCount: subEdgeResult.totalCount,
    cacheHits,
    cacheMisses,
  };
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

/**
 * Extract and persist session state from the full turn list.
 * Non-critical — errors are logged but don't fail ingestion.
 */
function saveSessionState(
  turns: Turn[],
  sessionId: string,
  projectSlug: string,
  projectPath: string,
): void {
  try {
    const state = extractSessionState(turns);
    const endedAt = turns.length > 0 ? turns[turns.length - 1].startTime : new Date().toISOString();
    upsertSessionState(sessionId, projectSlug, projectPath || null, endedAt, state);
  } catch (error) {
    log.warn('Failed to extract session state', { sessionId, error: String(error) });
  }
}
