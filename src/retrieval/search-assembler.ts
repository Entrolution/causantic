/**
 * Pure search pipeline for semantic discovery.
 *
 * Pipeline: embed → [vector, keyword] → RRF → cluster expand → dedupe → recency → budget
 *
 * No graph traversal. Used for the `search` MCP tool and as fallback for episodic recall
 * when no qualifying chain is found.
 */

import { vectorStore } from '../storage/vector-store.js';
import { getChunkById } from '../storage/chunk-store.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../config/loader.js';
import { approximateTokens } from '../utils/token-counter.js';
import { KeywordStore } from '../storage/keyword-store.js';
import { fuseRRF, type RankedItem } from './rrf.js';
import { expandViaClusters } from './cluster-expander.js';
import { reorderWithMMR } from './mmr.js';
import { createLogger } from '../utils/logger.js';
import type { StoredChunk } from '../storage/types.js';

const log = createLogger('search-assembler');

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
    source?: 'vector' | 'keyword' | 'cluster';
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

async function getEmbedder(): Promise<Embedder> {
  if (!sharedEmbedder) {
    sharedEmbedder = new Embedder();
    await sharedEmbedder.load(getModel('jina-small'));
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
 * Run the search pipeline: embed → vector + keyword → RRF → cluster expand → budget.
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

  const { hybridSearch, clusterExpansion, mmrReranking } = config;

  // 1. Embed query
  const embedder = await getEmbedder();
  const queryResult = await embedder.embed(query, true);

  // 2. Vector + keyword search in parallel
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

  // Post-filter by agent when no project filter was used (search() doesn't support agentId)
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
      queryEmbedding: queryResult.embedding,
      seedIds: [],
    };
  }

  // 3. Convert and fuse with RRF
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

  const fusedResults = fuseRRF(
    [
      { items: vectorItems, weight: hybridSearch.vectorWeight },
      ...(keywordItems.length > 0
        ? [{ items: keywordItems, weight: hybridSearch.keywordWeight }]
        : []),
    ],
    hybridSearch.rrfK,
  );

  // 4. Cluster expansion
  const expandedResults = skipClusters
    ? fusedResults
    : expandViaClusters(fusedResults, clusterExpansion, projectFilter, agentFilter);

  // Track sources
  type ChunkSource = 'vector' | 'keyword' | 'cluster';
  const sourceMap = new Map<string, ChunkSource>();
  for (const item of expandedResults) {
    if (item.source && !sourceMap.has(item.chunkId)) {
      sourceMap.set(item.chunkId, item.source as ChunkSource);
    }
  }

  // 5. Extract top-5 seed IDs for chain walking
  const seedIds = expandedResults.slice(0, 5).map((r) => r.chunkId);

  // 6. Dedupe
  const seen = new Set<string>();
  const deduped = expandedResults.filter((r) => {
    if (seen.has(r.chunkId)) return false;
    seen.add(r.chunkId);
    return true;
  });

  // 7. Recency boost (time-decay + session boost)
  const { recency } = config;
  const now = Date.now();
  const ln2 = Math.LN2;

  for (const item of deduped) {
    const chunk = getChunkById(item.chunkId);
    if (!chunk) continue;

    // Time-decay boost: 1 + decayFactor * exp(-ageHours * ln2 / halfLifeHours)
    const ageMs = now - new Date(chunk.startTime).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const timeBoost = 1 + recency.decayFactor * Math.exp((-ageHours * ln2) / recency.halfLifeHours);

    // Session boost: current session gets additional 1.2x
    const sessionBoost = currentSessionId && chunk.sessionId === currentSessionId ? 1.2 : 1.0;

    item.score *= timeBoost * sessionBoost;
  }
  deduped.sort((a, b) => b.score - a.score);

  // 7.5. MMR reranking (diversity-aware ordering)
  const reordered = await reorderWithMMR(deduped, queryResult.embedding, mmrReranking);

  // 8. Assemble within budget
  const assembled = assembleWithinBudget(reordered, maxTokens, sourceMap);

  return {
    text: assembled.text,
    tokenCount: assembled.tokenCount,
    chunks: assembled.includedChunks,
    totalConsidered: deduped.length,
    durationMs: Date.now() - startTime,
    queryEmbedding: queryResult.embedding,
    seedIds,
  };
}

/**
 * Assemble text within token budget.
 */
function assembleWithinBudget(
  ranked: RankedItem[],
  maxTokens: number,
  sourceMap: Map<string, 'vector' | 'keyword' | 'cluster'>,
): {
  text: string;
  tokenCount: number;
  includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
    source?: 'vector' | 'keyword' | 'cluster';
  }>;
} {
  const parts: string[] = [];
  const includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
    source?: 'vector' | 'keyword' | 'cluster';
  }> = [];
  let totalTokens = 0;

  for (const item of ranked) {
    const chunk = getChunkById(item.chunkId);
    if (!chunk) continue;

    const chunkTokens = chunk.approxTokens || approximateTokens(chunk.content);

    if (totalTokens + chunkTokens > maxTokens) {
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 100) {
        const truncated = truncateChunk(chunk.content, remainingTokens);
        parts.push(formatChunkForOutput(chunk, truncated, item.score));
        totalTokens += approximateTokens(truncated);
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

    parts.push(formatChunkForOutput(chunk, chunk.content, item.score));
    totalTokens += chunkTokens;
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
    tokenCount: totalTokens,
    includedChunks,
  };
}

function formatChunkForOutput(chunk: StoredChunk, content: string, weight: number): string {
  const date = new Date(chunk.startTime).toLocaleDateString();
  const relevance = (weight * 100).toFixed(0);
  const agentPart = chunk.agentId && chunk.agentId !== 'ui' ? ` | Agent: ${chunk.agentId}` : '';
  return `[Session: ${chunk.sessionSlug}${agentPart} | Date: ${date} | Relevance: ${relevance}%]\n${content}`;
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

  const embedder = await getEmbedder();
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
  }
}
