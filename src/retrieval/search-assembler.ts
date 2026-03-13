/**
 * Pure search pipeline for semantic discovery.
 *
 * Pipeline: embed → [vector, keyword] → RRF → cluster expand → dedupe → recency → budget
 *
 * No graph traversal. Used for the `search` MCP tool and as fallback for episodic recall
 * when no qualifying chain is found.
 */

import { vectorStore, indexVectorStore } from '../storage/vector-store.js';
import { getChunkById } from '../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  dereferenceToChunkIds,
  searchIndexEntriesByKeyword,
} from '../storage/index-entry-store.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../config/loader.js';
import { approximateTokens } from '../utils/token-counter.js';
import { KeywordStore } from '../storage/keyword-store.js';
import { fuseRRF, type RankedItem } from './rrf.js';
import { expandViaClusters } from './cluster-expander.js';
import { reorderWithMMR } from './mmr.js';
import { extractEntities } from '../utils/entity-extractor.js';
import { findEntitiesByAlias, getChunkIdsForEntity } from '../storage/entity-store.js';
import { createLogger } from '../utils/logger.js';
import { formatSearchChunk } from './formatting.js';

const log = createLogger('search-assembler');

/** RRF weight for entity-boosted results. */
const ENTITY_RRF_BOOST = 1.5;

/**
 * Request for search-based context retrieval.
 */
export interface SearchRequest {
  /** Query text */
  query: string;
  /** Current session ID (optional, for recency boost) */
  currentSessionId?: string;
  /** Filter results to specific project(s) */
  projectFilter?: string | string[];
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Number of vector search results */
  vectorSearchLimit?: number;
  /** Skip cluster expansion (for benchmarking) */
  skipClusters?: boolean;
  /** Filter results to a specific agent */
  agentFilter?: string;
}

/**
 * Search response with assembled context.
 */
export interface SearchResponse {
  /** Assembled context text */
  text: string;
  /** Approximate token count */
  tokenCount: number;
  /** Chunks included in response */
  chunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
    source?: 'vector' | 'keyword' | 'cluster' | 'entity';
  }>;
  /** Total chunks considered */
  totalConsidered: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Query embedding (for downstream chain walking) */
  queryEmbedding: number[];
  /** Top seed IDs from RRF (for chain walking) */
  seedIds: string[];
}

/**
 * Shared embedder instance.
 */
let sharedEmbedder: Embedder | null = null;
let sharedEmbedderModelId: string | null = null;

/**
 * Get or create a shared embedder for the given model.
 * Exported for use by chain-assembler for lazy query embedding.
 */
export async function getEmbedder(embeddingModel: string): Promise<Embedder> {
  if (!sharedEmbedder || sharedEmbedderModelId !== embeddingModel) {
    if (sharedEmbedder) {
      await sharedEmbedder.dispose();
    }
    sharedEmbedder = new Embedder();
    await sharedEmbedder.load(getModel(embeddingModel));
    sharedEmbedderModelId = embeddingModel;
  }
  return sharedEmbedder;
}

/**
 * Shared keyword store instance.
 */
let sharedKeywordStore: KeywordStore | null = null;

function getKeywordStore(): KeywordStore {
  if (!sharedKeywordStore) {
    sharedKeywordStore = new KeywordStore();
  }
  return sharedKeywordStore;
}

/**
 * Extract entity mentions from the query and find matching chunks.
 * Returns ranked items suitable for RRF fusion.
 */
function getEntityResults(query: string, projectFilter?: string | string[]): RankedItem[] {
  const mentions = extractEntities(query);
  if (mentions.length === 0) return [];

  const project = typeof projectFilter === 'string' ? projectFilter : undefined;
  if (!project) return []; // entity lookup requires project scope

  const chunkIds = new Set<string>();
  for (const mention of mentions) {
    const entities = findEntitiesByAlias(mention.normalizedName, mention.entityType, project);
    for (const entity of entities) {
      for (const cid of getChunkIdsForEntity(entity.id, 100)) {
        chunkIds.add(cid);
      }
    }
  }

  return [...chunkIds].map((id, i) => ({
    chunkId: id,
    score: 1.0 / (i + 1),
    source: 'entity' as const,
  }));
}

/**
 * Run the search pipeline.
 *
 * Keyword-primary mode: keyword → [optional vector enrichment] → recency → MMR → budget
 * Hybrid mode:          embed → [vector, keyword] → RRF → cluster expand → recency → MMR → budget
 */
export async function searchContext(request: SearchRequest): Promise<SearchResponse> {
  const startTime = Date.now();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);

  const {
    query,
    currentSessionId,
    projectFilter,
    maxTokens = config.mcpMaxResponseTokens,
    vectorSearchLimit = 20,
    skipClusters = false,
    agentFilter,
  } = request;

  const { hybridSearch, clusterExpansion, mmrReranking, embeddingModel } = config;
  const retrievalMode = config.retrievalPrimary;

  let fusedResults: RankedItem[];
  let queryEmbedding: number[] = [];
  let useIndexSearch = false;

  if (retrievalMode === 'keyword') {
    // ── Keyword-primary search path ──────────────────────────────────────
    // No embedding needed unless vector enrichment is enabled.

    let keywordResults: Array<{ id: string; score: number }> = [];
    try {
      const keywordStore = getKeywordStore();
      keywordResults = projectFilter
        ? keywordStore.searchByProject(
            query,
            projectFilter,
            hybridSearch.keywordSearchLimit,
            agentFilter,
          )
        : keywordStore.search(query, hybridSearch.keywordSearchLimit);
    } catch (error) {
      log.warn('Keyword search failed', { error: (error as Error).message });
    }

    // Post-filter by agent when no project filter was used
    if (agentFilter && !projectFilter) {
      keywordResults = keywordResults.filter((r) => {
        const chunk = getChunkById(r.id);
        return chunk?.agentId === agentFilter;
      });
    }

    fusedResults = keywordResults.map((r) => ({
      chunkId: r.id,
      score: r.score,
      source: 'keyword' as const,
    }));

    // Optional vector enrichment: merge vector results via RRF
    if (config.vectorEnrichment) {
      try {
        vectorStore.setModelId(embeddingModel);
        const embedder = await getEmbedder(embeddingModel);
        const queryResult = await embedder.embed(query, true);
        queryEmbedding = queryResult.embedding;

        let vectorResults = await (projectFilter
          ? vectorStore.searchByProject(
              queryResult.embedding,
              projectFilter,
              vectorSearchLimit,
              agentFilter,
            )
          : vectorStore.search(queryResult.embedding, vectorSearchLimit));

        if (agentFilter && !projectFilter) {
          vectorResults = vectorResults.filter((s) => {
            const chunk = getChunkById(s.id);
            return chunk?.agentId === agentFilter;
          });
        }

        if (vectorResults.length > 0) {
          const vectorItems: RankedItem[] = vectorResults.map((s) => ({
            chunkId: s.id,
            score: Math.max(0, 1 - s.distance),
            source: 'vector' as const,
          }));

          fusedResults = fuseRRF(
            [
              { items: fusedResults, weight: hybridSearch.keywordWeight },
              { items: vectorItems, weight: hybridSearch.vectorWeight },
            ],
            hybridSearch.rrfK,
          );
        }
      } catch (error) {
        log.warn('Vector enrichment failed, using keyword results only', {
          error: (error as Error).message,
        });
      }
    }

    // Entity boost: merge entity-matched chunks via RRF
    try {
      const entityItems = getEntityResults(query, projectFilter);
      if (entityItems.length > 0) {
        fusedResults = fuseRRF(
          [
            { items: fusedResults, weight: 1.0 },
            { items: entityItems, weight: ENTITY_RRF_BOOST },
          ],
          hybridSearch.rrfK,
        );
      }
    } catch (error) {
      log.warn('Entity search failed', { error: (error as Error).message });
    }

    if (fusedResults.length === 0) {
      return {
        text: '',
        tokenCount: 0,
        chunks: [],
        totalConsidered: 0,
        durationMs: Date.now() - startTime,
        queryEmbedding,
        seedIds: [],
      };
    }

    // Skip cluster expansion for keyword-primary mode
  } else {
    // ── Hybrid/vector search path ────────────────────────────────────────
    // Configure vector store for current model
    vectorStore.setModelId(embeddingModel);

    // 1. Embed query
    const embedder = await getEmbedder(embeddingModel);
    const queryResult = await embedder.embed(query, true);
    queryEmbedding = queryResult.embedding;

    // Determine whether to use index-based search
    useIndexSearch = config.semanticIndex.useForSearch && getIndexEntryCount() > 0;

    if (useIndexSearch) {
      // ── Index-based search path ──────────────────────────────────────
      indexVectorStore.setModelId(embeddingModel);

      const entryCount = getIndexEntryCount();
      const indexedChunks = getIndexedChunkCount();
      const entriesPerChunk = indexedChunks > 0 ? entryCount / indexedChunks : 1;
      const indexSearchLimit = Math.ceil(vectorSearchLimit * entriesPerChunk);

      const indexVectorPromise = projectFilter
        ? indexVectorStore.searchByProject(
            queryResult.embedding,
            projectFilter,
            indexSearchLimit,
            agentFilter,
          )
        : indexVectorStore.search(queryResult.embedding, indexSearchLimit);

      let indexKeywordResults: Array<{ id: string; score: number }> = [];
      try {
        indexKeywordResults = searchIndexEntriesByKeyword(
          query,
          hybridSearch.keywordSearchLimit,
          projectFilter,
          agentFilter,
        );
      } catch (error) {
        log.warn('Index keyword search unavailable', {
          error: (error as Error).message,
        });
      }

      let indexSimilar = await indexVectorPromise;

      if (agentFilter && !projectFilter) {
        indexSimilar = indexSimilar.filter((s) => {
          const agent = indexVectorStore.getChunkAgent(s.id);
          return agent === agentFilter;
        });
        indexKeywordResults = indexKeywordResults.filter((r) => {
          const agent = indexVectorStore.getChunkAgent(r.id);
          return agent === agentFilter;
        });
      }

      if (indexSimilar.length === 0 && indexKeywordResults.length === 0) {
        return {
          text: '',
          tokenCount: 0,
          chunks: [],
          totalConsidered: 0,
          durationMs: Date.now() - startTime,
          queryEmbedding,
          seedIds: [],
        };
      }

      const indexVectorItems: RankedItem[] = indexSimilar.map((s) => ({
        chunkId: s.id,
        score: Math.max(0, 1 - s.distance),
        source: 'vector' as const,
      }));

      const indexKeywordItems: RankedItem[] = indexKeywordResults.map((r) => ({
        chunkId: r.id,
        score: r.score,
        source: 'keyword' as const,
      }));

      const indexFused = fuseRRF(
        [
          { items: indexVectorItems, weight: hybridSearch.vectorWeight },
          ...(indexKeywordItems.length > 0
            ? [{ items: indexKeywordItems, weight: hybridSearch.keywordWeight }]
            : []),
        ],
        hybridSearch.rrfK,
      );

      const indexEntryIds = indexFused.map((r) => r.chunkId);
      const chunkIds = dereferenceToChunkIds(indexEntryIds);

      const chunkScoreMap = new Map<string, { score: number; source: RankedItem['source'] }>();
      for (const item of indexFused) {
        const entryChunkIds = dereferenceToChunkIds([item.chunkId]);
        for (const cid of entryChunkIds) {
          const existing = chunkScoreMap.get(cid);
          if (!existing || item.score > existing.score) {
            chunkScoreMap.set(cid, { score: item.score, source: item.source });
          }
        }
      }

      fusedResults = chunkIds.map((cid) => {
        const entry = chunkScoreMap.get(cid);
        return {
          chunkId: cid,
          score: entry?.score ?? 0,
          source: entry?.source,
        };
      });
    } else {
      // ── Chunk-based search path (fallback) ─────────────────────────────
      const vectorSearchPromise = projectFilter
        ? vectorStore.searchByProject(
            queryResult.embedding,
            projectFilter,
            vectorSearchLimit,
            agentFilter,
          )
        : vectorStore.search(queryResult.embedding, vectorSearchLimit);

      let keywordResults: Array<{ id: string; score: number }> = [];
      try {
        const keywordStore = getKeywordStore();
        keywordResults = projectFilter
          ? keywordStore.searchByProject(
              query,
              projectFilter,
              hybridSearch.keywordSearchLimit,
              agentFilter,
            )
          : keywordStore.search(query, hybridSearch.keywordSearchLimit);
      } catch (error) {
        log.warn('Keyword search unavailable, falling back to vector-only', {
          error: (error as Error).message,
        });
      }

      let similar = await vectorSearchPromise;

      if (agentFilter && !projectFilter) {
        similar = similar.filter((s) => {
          const chunk = getChunkById(s.id);
          return chunk?.agentId === agentFilter;
        });
        keywordResults = keywordResults.filter((r) => {
          const chunk = getChunkById(r.id);
          return chunk?.agentId === agentFilter;
        });
      }

      if (similar.length === 0 && keywordResults.length === 0) {
        return {
          text: '',
          tokenCount: 0,
          chunks: [],
          totalConsidered: 0,
          durationMs: Date.now() - startTime,
          queryEmbedding,
          seedIds: [],
        };
      }

      const vectorItems: RankedItem[] = similar.map((s) => ({
        chunkId: s.id,
        score: Math.max(0, 1 - s.distance),
        source: 'vector' as const,
      }));

      const keywordItems: RankedItem[] = keywordResults.map((r) => ({
        chunkId: r.id,
        score: r.score,
        source: 'keyword' as const,
      }));

      fusedResults = fuseRRF(
        [
          { items: vectorItems, weight: hybridSearch.vectorWeight },
          ...(keywordItems.length > 0
            ? [{ items: keywordItems, weight: hybridSearch.keywordWeight }]
            : []),
        ],
        hybridSearch.rrfK,
      );
    }

    // Entity boost (hybrid/vector path)
    try {
      const entityItems = getEntityResults(query, projectFilter);
      if (entityItems.length > 0) {
        fusedResults = fuseRRF(
          [
            { items: fusedResults, weight: 1.0 },
            { items: entityItems, weight: ENTITY_RRF_BOOST },
          ],
          hybridSearch.rrfK,
        );
      }
    } catch (error) {
      log.warn('Entity search failed', { error: (error as Error).message });
    }

    // Cluster expansion (hybrid/vector path only)
    if (!skipClusters) {
      fusedResults = expandViaClusters(
        fusedResults,
        clusterExpansion,
        projectFilter,
        agentFilter,
        config.feedbackWeight,
      );
    }
  }

  // ── Shared post-processing ───────────────────────────────────────────

  // Track sources
  type ChunkSource = 'vector' | 'keyword' | 'cluster' | 'entity';
  const sourceMap = new Map<string, ChunkSource>();
  for (const item of fusedResults) {
    if (item.source && !sourceMap.has(item.chunkId)) {
      sourceMap.set(item.chunkId, item.source as ChunkSource);
    }
  }

  // Extract top-5 seed IDs for chain walking
  const seedIds = fusedResults.slice(0, 5).map((r) => r.chunkId);

  // Dedupe
  const seen = new Set<string>();
  const deduped = fusedResults.filter((r) => {
    if (seen.has(r.chunkId)) return false;
    seen.add(r.chunkId);
    return true;
  });

  // Recency boost (time-decay + session boost)
  const { recency } = config;
  const now = Date.now();
  const ln2 = Math.LN2;
  const chunkTokenMap = new Map<string, number>();

  for (const item of deduped) {
    const chunk = getChunkById(item.chunkId);
    if (!chunk) continue;

    const chunkTokens = chunk.approxTokens || 500;
    chunkTokenMap.set(item.chunkId, chunkTokens);

    // Time-decay boost
    const ageMs = now - new Date(chunk.startTime).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const timeBoost = 1 + recency.decayFactor * Math.exp((-ageHours * ln2) / recency.halfLifeHours);

    // Session boost: current session gets additional 1.2x
    const sessionBoost = currentSessionId && chunk.sessionId === currentSessionId ? 1.2 : 1.0;

    // Length penalty: logarithmic penalty for large, keyword-rich chunks
    // Disabled when using index search (entries are normalised, no length bias)
    let lengthFactor = 1.0;
    if (config.lengthPenalty.enabled && !useIndexSearch) {
      lengthFactor =
        1 / (1 + Math.log2(Math.max(1, chunkTokens / config.lengthPenalty.referenceTokens)));
    }

    item.score *= timeBoost * sessionBoost * lengthFactor;
  }
  deduped.sort((a, b) => b.score - a.score);

  // Exclude oversized chunks (larger than the response budget)
  const sizeBounded = deduped.filter((item) => {
    const tokens = chunkTokenMap.get(item.chunkId);
    return tokens !== undefined && tokens <= maxTokens;
  });

  // MMR reranking (diversity-aware, budget-aware ordering)
  const reordered = await reorderWithMMR(sizeBounded, queryEmbedding, mmrReranking, {
    tokenBudget: maxTokens,
    chunkTokenCounts: chunkTokenMap,
  });

  // Normalize scores for display (top result = 1.0)
  if (reordered.length > 0) {
    const maxScore = reordered[0].score;
    if (maxScore > 0) {
      for (const item of reordered) {
        item.score = item.score / maxScore;
      }
    }
  }

  // Assemble within budget
  const assembled = assembleWithinBudget(reordered, maxTokens, sourceMap);

  return {
    text: assembled.text,
    tokenCount: assembled.tokenCount,
    chunks: assembled.includedChunks,
    totalConsidered: deduped.length,
    durationMs: Date.now() - startTime,
    queryEmbedding,
    seedIds,
  };
}

/**
 * Formatting overhead constants.
 *
 * Per-chunk: header (~50 tokens from formatSearchChunk) + separator (~3 tokens) + margin.
 * Fixed: response header (~20 tokens) + diagnostics (~100-500 tokens) added by tools.ts.
 */
const SEARCH_FIXED_OVERHEAD = 200;
const SEARCH_PER_CHUNK_OVERHEAD = 55;

/**
 * Assemble text within token budget, reserving space for formatting overhead.
 */
function assembleWithinBudget(
  ranked: RankedItem[],
  maxTokens: number,
  sourceMap: Map<string, 'vector' | 'keyword' | 'cluster' | 'entity'>,
): {
  text: string;
  tokenCount: number;
  includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
    source?: 'vector' | 'keyword' | 'cluster' | 'entity';
  }>;
} {
  const effectiveBudget = Math.max(0, maxTokens - SEARCH_FIXED_OVERHEAD);

  const parts: string[] = [];
  const includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
    source?: 'vector' | 'keyword' | 'cluster' | 'entity';
  }> = [];
  let budgetUsed = 0;

  for (const item of ranked) {
    const chunk = getChunkById(item.chunkId);
    if (!chunk) continue;

    const chunkTokens = chunk.approxTokens || approximateTokens(chunk.content);
    const chunkCost = chunkTokens + SEARCH_PER_CHUNK_OVERHEAD;

    if (budgetUsed + chunkCost > effectiveBudget) {
      const remainingTokens = effectiveBudget - budgetUsed - SEARCH_PER_CHUNK_OVERHEAD;
      if (remainingTokens > 100) {
        const truncated = truncateChunk(chunk.content, remainingTokens);
        parts.push(formatSearchChunk(chunk, truncated, item.score));
        budgetUsed += approximateTokens(truncated) + SEARCH_PER_CHUNK_OVERHEAD;
        includedChunks.push({
          id: chunk.id,
          sessionSlug: chunk.sessionSlug,
          weight: item.score,
          preview: truncated.slice(0, 100) + '...',
          source: sourceMap.get(chunk.id),
        });
      }
      break;
    }

    parts.push(formatSearchChunk(chunk, chunk.content, item.score));
    budgetUsed += chunkCost;
    includedChunks.push({
      id: chunk.id,
      sessionSlug: chunk.sessionSlug,
      weight: item.score,
      preview: chunk.content.slice(0, 100) + (chunk.content.length > 100 ? '...' : ''),
      source: sourceMap.get(chunk.id),
    });
  }

  return {
    text: parts.join('\n\n---\n\n'),
    tokenCount: budgetUsed,
    includedChunks,
  };
}

function truncateChunk(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;

  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n\n');

  if (lastNewline > maxChars * 0.5) {
    return truncated.slice(0, lastNewline) + '\n\n...[truncated]';
  }
  return truncated + '\n...[truncated]';
}

/**
 * Result from similarity search for semantic deletion.
 */
export interface SimilarChunkResult {
  id: string;
  /** Similarity score 0-1 (higher = more similar). */
  score: number;
}

/**
 * Find chunk IDs similar to a query within a project.
 * Uses vector-only search (no keyword/RRF/cluster expansion) for precision.
 */
export async function findSimilarChunkIds(options: {
  query: string;
  project: string;
  threshold?: number;
}): Promise<SimilarChunkResult[]> {
  const { query, project } = options;
  let { threshold = 0.6 } = options;

  // Auto-detect percentage input: values >1 treated as percentages (e.g., 60 → 0.6)
  if (threshold > 1) {
    threshold = threshold / 100;
  }

  const externalConfig = loadConfig();
  const runtimeConfig = toRuntimeConfig(externalConfig);
  vectorStore.setModelId(runtimeConfig.embeddingModel);
  const embedder = await getEmbedder(runtimeConfig.embeddingModel);
  const { embedding } = await embedder.embed(query, true);

  // searchByProject is O(n) brute-force regardless of limit — high limit is free
  const results = await vectorStore.searchByProject(embedding, project, Number.MAX_SAFE_INTEGER);

  // Angular distance 0=identical, 2=opposite. Score = max(0, 1-distance).
  const filtered: SimilarChunkResult[] = [];
  for (const r of results) {
    const score = Math.max(0, 1 - r.distance);
    if (score >= threshold) {
      filtered.push({ id: r.id, score });
    }
  }

  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

/**
 * Cleanup shared resources.
 */
export async function disposeSearch(): Promise<void> {
  if (sharedEmbedder) {
    await sharedEmbedder.dispose();
    sharedEmbedder = null;
    sharedEmbedderModelId = null;
  }
}
