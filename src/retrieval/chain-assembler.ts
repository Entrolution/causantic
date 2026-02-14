/**
 * Chain assembler for episodic retrieval.
 *
 * Combines search (for seed finding) with chain walking (for narrative construction).
 * Used by the `recall` and `predict` MCP tools.
 *
 * Pipeline:
 * 1. Run searchContext() to get seeds and query embedding
 * 2. Walk chains from seeds (backward for recall, forward for predict)
 * 3. Select best chain by median per-node score
 * 4. If no chain qualifies (all seeds orphaned), fall back to search results
 */

import { approximateTokens } from '../utils/token-counter.js';
import { searchContext, type SearchRequest } from './search-assembler.js';
import { walkChains, selectBestChain, type Chain } from './chain-walker.js';
import type { StoredChunk } from '../storage/types.js';

/**
 * Request for episodic retrieval.
 */
export interface EpisodicRequest {
  /** Query text */
  query: string;
  /** Current session ID (optional) */
  currentSessionId?: string;
  /** Filter results to specific project(s) */
  projectFilter?: string | string[];
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Number of vector search results */
  vectorSearchLimit?: number;
}

/**
 * Episodic response with chain or search fallback.
 */
export interface EpisodicResponse {
  /** Assembled context text */
  text: string;
  /** Approximate token count */
  tokenCount: number;
  /** Chunks included in response (ordered chronologically for chains) */
  chunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
  }>;
  /** Whether a chain was found or fell back to search */
  mode: 'chain' | 'search-fallback';
  /** Chain length (0 if fallback) */
  chainLength: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Recall: find seeds → walk backward → reverse for chronological narrative.
 */
export async function recallContext(request: EpisodicRequest): Promise<EpisodicResponse> {
  return runEpisodicPipeline(request, 'backward');
}

/**
 * Predict: find seeds → walk forward → output in traversal order.
 */
export async function predictContext(request: EpisodicRequest): Promise<EpisodicResponse> {
  return runEpisodicPipeline(request, 'forward');
}

/**
 * Core episodic pipeline shared by recall and predict.
 */
async function runEpisodicPipeline(
  request: EpisodicRequest,
  direction: 'forward' | 'backward',
): Promise<EpisodicResponse> {
  const startTime = Date.now();

  const { query, currentSessionId, projectFilter, maxTokens = 20000, vectorSearchLimit } = request;

  // 1. Search for seeds
  const searchRequest: SearchRequest = {
    query,
    currentSessionId,
    projectFilter,
    maxTokens,
    vectorSearchLimit,
  };

  const searchResult = await searchContext(searchRequest);

  if (searchResult.seedIds.length === 0) {
    return {
      text: searchResult.text,
      tokenCount: searchResult.tokenCount,
      chunks: searchResult.chunks.map((c) => ({
        id: c.id,
        sessionSlug: c.sessionSlug,
        weight: c.weight,
        preview: c.preview,
      })),
      mode: 'search-fallback',
      chainLength: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Walk chains from seeds
  const chains = await walkChains(searchResult.seedIds, {
    direction,
    tokenBudget: maxTokens,
    queryEmbedding: searchResult.queryEmbedding,
  });

  // 3. Select best chain
  const bestChain = selectBestChain(chains);

  if (!bestChain) {
    // Fallback to search results
    return {
      text: searchResult.text,
      tokenCount: searchResult.tokenCount,
      chunks: searchResult.chunks.map((c) => ({
        id: c.id,
        sessionSlug: c.sessionSlug,
        weight: c.weight,
        preview: c.preview,
      })),
      mode: 'search-fallback',
      chainLength: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 4. Format chain as narrative
  const formatted = formatChain(bestChain, direction);

  return {
    text: formatted.text,
    tokenCount: formatted.tokenCount,
    chunks: formatted.chunks,
    mode: 'chain',
    chainLength: bestChain.chunkIds.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Format a chain as ordered narrative.
 * Backward chains are reversed for chronological output (problem → solution).
 */
function formatChain(
  chain: Chain,
  direction: 'forward' | 'backward',
): {
  text: string;
  tokenCount: number;
  chunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
  }>;
} {
  // Backward chains need reversal for chronological order
  const orderedChunks = direction === 'backward' ? [...chain.chunks].reverse() : chain.chunks;
  const orderedIds = direction === 'backward' ? [...chain.chunkIds].reverse() : chain.chunkIds;

  const parts: string[] = [];
  const resultChunks: Array<{
    id: string;
    sessionSlug: string;
    weight: number;
    preview: string;
  }> = [];
  let totalTokens = 0;

  for (let i = 0; i < orderedChunks.length; i++) {
    const chunk = orderedChunks[i];
    const chunkTokens = chunk.approxTokens || approximateTokens(chunk.content);

    parts.push(formatChunkForOutput(chunk, chunk.content, i + 1, orderedChunks.length));
    totalTokens += chunkTokens;
    resultChunks.push({
      id: orderedIds[i],
      sessionSlug: chunk.sessionSlug,
      weight: chain.medianScore,
      preview: chunk.content.slice(0, 100) + (chunk.content.length > 100 ? '...' : ''),
    });
  }

  return {
    text: parts.join('\n\n---\n\n'),
    tokenCount: totalTokens,
    chunks: resultChunks,
  };
}

function formatChunkForOutput(
  chunk: StoredChunk,
  content: string,
  position: number,
  total: number,
): string {
  const date = new Date(chunk.startTime).toLocaleDateString();
  return `[${position}/${total} | Session: ${chunk.sessionSlug} | Date: ${date}]\n${content}`;
}
