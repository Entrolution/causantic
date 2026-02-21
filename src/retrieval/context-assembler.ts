/**
 * Context assembly for memory retrieval.
 *
 * Delegates to specialized modules:
 * - searchContext() for pure semantic search (no graph)
 * - recallContext() for episodic recall (backward chain walking)
 * - predictContext() for episodic prediction (forward chain walking)
 */

import { searchContext, disposeSearch, type SearchResponse } from './search-assembler.js';
import { recallContext, predictContext, type EpisodicResponse } from './chain-assembler.js';

// Re-export types from sub-modules
export type { SearchRequest, SearchResponse } from './search-assembler.js';
export type { EpisodicRequest, EpisodicResponse } from './chain-assembler.js';

/**
 * Request for context retrieval (backward compat).
 */
export interface RetrievalRequest {
  /** Query text to find relevant context for */
  query: string;
  /** Current session ID (optional, for recency boost) */
  currentSessionId?: string;
  /** Filter results to specific project(s). Omit to search all projects. */
  projectFilter?: string | string[];
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Retrieval mode */
  mode: 'recall' | 'predict' | 'search';
  /** Number of vector search results to start from */
  vectorSearchLimit?: number;
  /** Filter results to a specific agent */
  agentFilter?: string;
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
    source?: 'vector' | 'keyword' | 'cluster';
  }>;
  /** Total chunks considered */
  totalConsidered: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Chain walk diagnostics (present when episodic retrieval falls back to search) */
  diagnostics?: {
    searchResultCount: number;
    seedCount: number;
    chainsAttempted: number;
    chainLengths: number[];
    fallbackReason?: string;
  };
}

/**
 * Assemble context from memory based on a query.
 * Delegates to searchContext (pure search, no graph).
 */
export async function assembleContext(request: RetrievalRequest): Promise<RetrievalResponse> {
  const searchResponse = await searchContext({
    query: request.query,
    currentSessionId: request.currentSessionId,
    projectFilter: request.projectFilter,
    maxTokens: request.maxTokens,
    vectorSearchLimit: request.vectorSearchLimit,
    agentFilter: request.agentFilter,
  });

  return searchResponseToRetrievalResponse(searchResponse);
}

/**
 * Recall: episodic retrieval walking backward through causal chains.
 */
export async function recall(
  query: string,
  options: Partial<RetrievalRequest> = {},
): Promise<RetrievalResponse> {
  const response = await recallContext({
    query,
    currentSessionId: options.currentSessionId,
    projectFilter: options.projectFilter,
    maxTokens: options.maxTokens,
    vectorSearchLimit: options.vectorSearchLimit,
    agentFilter: options.agentFilter,
  });

  return episodicResponseToRetrievalResponse(response);
}

/**
 * Predict: episodic retrieval walking forward through causal chains.
 */
export async function predict(
  context: string,
  options: Partial<RetrievalRequest> = {},
): Promise<RetrievalResponse> {
  const response = await predictContext({
    query: context,
    currentSessionId: options.currentSessionId,
    projectFilter: options.projectFilter,
    maxTokens: options.maxTokens,
    vectorSearchLimit: options.vectorSearchLimit,
    agentFilter: options.agentFilter,
  });

  return episodicResponseToRetrievalResponse(response);
}

/**
 * Cleanup shared resources.
 */
export async function disposeRetrieval(): Promise<void> {
  await disposeSearch();
}

// Adapters

function searchResponseToRetrievalResponse(response: SearchResponse): RetrievalResponse {
  return {
    text: response.text,
    tokenCount: response.tokenCount,
    chunks: response.chunks,
    totalConsidered: response.totalConsidered,
    durationMs: response.durationMs,
  };
}

function episodicResponseToRetrievalResponse(response: EpisodicResponse): RetrievalResponse {
  return {
    text: response.text,
    tokenCount: response.tokenCount,
    chunks: response.chunks,
    totalConsidered: response.chunks.length,
    durationMs: response.durationMs,
    diagnostics: response.diagnostics,
  };
}
