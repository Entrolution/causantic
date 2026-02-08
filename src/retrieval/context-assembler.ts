/**
 * Context assembly for memory retrieval.
 * Combines vector search with graph traversal to assemble relevant context.
 */

import { vectorStore } from '../storage/vector-store.js';
import { getChunkById, getChunksByIds } from '../storage/chunk-store.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { getConfig } from '../config/memory-config.js';
import { approximateTokens } from '../utils/token-counter.js';
import { traverse, traverseMultiple, dedupeAndRank, resolveChunks } from './traverser.js';
import type { StoredChunk, WeightedChunk } from '../storage/types.js';
import { getReferenceClock } from '../storage/clock-store.js';

/**
 * Retrieval mode determines traversal direction and ranking.
 */
export type RetrievalMode = 'recall' | 'explain' | 'predict';

/**
 * Range hint for retrieval - lets Claude choose appropriate decay model.
 * - 'short': Recent context (15min hold) - best for immediate follow-ups
 * - 'long': Distant context (60min hold) - best for cross-session/historical
 * - 'auto': System decides based on query characteristics
 */
export type RetrievalRange = 'short' | 'long' | 'auto';

/**
 * Request for context retrieval.
 */
export interface RetrievalRequest {
  /** Query text to find relevant context for */
  query: string;
  /** Current session ID (optional, for recency boost) */
  currentSessionId?: string;
  /** Project slug for clock lookup (optional, enables vector clock decay) */
  projectSlug?: string;
  /** Query time for decay calculation (default: now) */
  queryTime?: number;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Retrieval mode */
  mode: RetrievalMode;
  /** Range hint: 'short' for recent, 'long' for historical, 'auto' to decide */
  range?: RetrievalRange;
  /** Number of vector search results to start from */
  vectorSearchLimit?: number;
}

/**
 * Retrieval response with assembled context.
 */
export interface RetrievalResponse {
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
  }>;
  /** Total chunks considered */
  totalConsidered: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Shared embedder instance for retrieval.
 */
let sharedEmbedder: Embedder | null = null;

/**
 * Get or create shared embedder.
 */
async function getEmbedder(): Promise<Embedder> {
  if (!sharedEmbedder) {
    sharedEmbedder = new Embedder();
    await sharedEmbedder.load(getModel('jina-small'));
  }
  return sharedEmbedder;
}

/**
 * Assemble context from memory based on a query.
 */
export async function assembleContext(request: RetrievalRequest): Promise<RetrievalResponse> {
  const startTime = Date.now();
  const config = getConfig();

  const {
    query,
    currentSessionId,
    projectSlug,
    queryTime = Date.now(),
    maxTokens = config.mcpMaxResponseTokens,
    mode,
    range = 'auto',
    vectorSearchLimit = 20,
  } = request;

  // Get reference clock for vector clock-based decay (if project slug provided)
  const referenceClock = projectSlug ? getReferenceClock(projectSlug) : undefined;

  // 1. Embed query
  const embedder = await getEmbedder();
  const queryResult = await embedder.embed(query, true); // isQuery = true

  // 2. Find similar chunks via vector search
  const similar = await vectorStore.search(queryResult.embedding, vectorSearchLimit);

  if (similar.length === 0) {
    return {
      text: '',
      tokenCount: 0,
      chunks: [],
      totalConsidered: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Determine traversal direction and decay model based on mode and range
  const direction = mode === 'predict' ? 'forward' : 'backward';

  // Select decay model based on range hint
  // - 'short': Use short-range decay (15min hold) for recent context
  // - 'long': Use long-range decay (60min hold) for historical context
  // - 'auto': Use long-range for explain mode, short-range otherwise
  let decayConfig;
  if (direction === 'forward') {
    decayConfig = config.forwardDecay;
  } else if (range === 'short') {
    decayConfig = config.shortRangeDecay;
  } else if (range === 'long') {
    decayConfig = config.longRangeDecay;
  } else {
    // Auto: explain mode benefits from long-range, recall from short-range
    decayConfig = mode === 'explain' ? config.longRangeDecay : config.shortRangeDecay;
  }

  // 4. Traverse graph from similar chunks
  // Convert distances to weights (1 - distance for angular distance in [0,1])
  // Direction-specific hop decay curves are applied automatically:
  // - Backward: Linear (dies@10) for 4-20 hop range
  // - Forward: Delayed linear (5h, dies@20) for 1-20 hop range
  const startIds = similar.map((s) => s.id);
  const startWeights = similar.map((s) => Math.max(0, 1 - s.distance));

  const traversalResult = await traverseMultiple(startIds, startWeights, queryTime, {
    direction,
    decayConfig,
    referenceClock,
  });

  // 5. Combine vector search hits with traversal results
  const allChunks: WeightedChunk[] = [];

  // Add direct vector search hits
  for (let i = 0; i < similar.length; i++) {
    allChunks.push({
      chunkId: similar[i].id,
      weight: startWeights[i] * 1.5, // Boost direct hits
      depth: 0,
    });
  }

  // Add traversal results
  allChunks.push(...traversalResult.chunks);

  // 6. Dedupe and rank
  const ranked = dedupeAndRank(allChunks);

  // 7. Apply recency boost for current session
  if (currentSessionId) {
    for (const wc of ranked) {
      const chunk = getChunkById(wc.chunkId);
      if (chunk && chunk.sessionId === currentSessionId) {
        wc.weight *= 1.2; // 20% boost for current session
      }
    }
    // Re-sort after boost
    ranked.sort((a, b) => b.weight - a.weight);
  }

  // 8. Assemble within token budget
  const assembled = assembleWithinBudget(ranked, maxTokens);

  return {
    text: assembled.text,
    tokenCount: assembled.tokenCount,
    chunks: assembled.includedChunks,
    totalConsidered: ranked.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Assemble text within token budget.
 */
function assembleWithinBudget(
  ranked: WeightedChunk[],
  maxTokens: number
): {
  text: string;
  tokenCount: number;
  includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
  }>;
} {
  const parts: string[] = [];
  const includedChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
  }> = [];
  let totalTokens = 0;

  for (const wc of ranked) {
    const chunk = getChunkById(wc.chunkId);
    if (!chunk) continue;

    const chunkTokens = chunk.approxTokens || approximateTokens(chunk.content);

    // Check if adding this chunk would exceed budget
    if (totalTokens + chunkTokens > maxTokens) {
      // Try to fit a truncated version
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 100) {
        const truncated = truncateChunk(chunk.content, remainingTokens);
        parts.push(formatChunkForOutput(chunk, truncated, wc.weight));
        totalTokens += approximateTokens(truncated);
        includedChunks.push({
          id: chunk.id,
          sessionSlug: chunk.sessionSlug,
          weight: wc.weight,
          preview: truncated.slice(0, 100) + '...',
        });
      }
      break;
    }

    parts.push(formatChunkForOutput(chunk, chunk.content, wc.weight));
    totalTokens += chunkTokens;
    includedChunks.push({
      id: chunk.id,
      sessionSlug: chunk.sessionSlug,
      weight: wc.weight,
      preview: chunk.content.slice(0, 100) + (chunk.content.length > 100 ? '...' : ''),
    });
  }

  return {
    text: parts.join('\n\n---\n\n'),
    tokenCount: totalTokens,
    includedChunks,
  };
}

/**
 * Format a chunk for output with metadata header.
 */
function formatChunkForOutput(chunk: StoredChunk, content: string, weight: number): string {
  const date = new Date(chunk.startTime).toLocaleDateString();
  const relevance = (weight * 100).toFixed(0);

  return `[Session: ${chunk.sessionSlug} | Date: ${date} | Relevance: ${relevance}%]\n${content}`;
}

/**
 * Truncate chunk content to fit token budget.
 */
function truncateChunk(content: string, maxTokens: number): string {
  // Rough estimate: 4 chars per token
  const maxChars = maxTokens * 4;

  if (content.length <= maxChars) {
    return content;
  }

  // Try to cut at a paragraph boundary
  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n\n');

  if (lastNewline > maxChars * 0.5) {
    return truncated.slice(0, lastNewline) + '\n\n...[truncated]';
  }

  return truncated + '\n...[truncated]';
}

/**
 * Recall: retrieve context relevant to a query.
 */
export async function recall(
  query: string,
  options: Partial<RetrievalRequest> = {}
): Promise<RetrievalResponse> {
  return assembleContext({
    query,
    mode: 'recall',
    ...options,
  });
}

/**
 * Explain: retrieve context that explains how we got to current state.
 */
export async function explain(
  topic: string,
  options: Partial<RetrievalRequest> = {}
): Promise<RetrievalResponse> {
  return assembleContext({
    query: topic,
    mode: 'explain',
    ...options,
  });
}

/**
 * Predict: retrieve context that might be relevant next.
 */
export async function predict(
  context: string,
  options: Partial<RetrievalRequest> = {}
): Promise<RetrievalResponse> {
  return assembleContext({
    query: context,
    mode: 'predict',
    ...options,
  });
}

/**
 * Cleanup shared resources.
 */
export async function disposeRetrieval(): Promise<void> {
  if (sharedEmbedder) {
    await sharedEmbedder.dispose();
    sharedEmbedder = null;
  }
}
