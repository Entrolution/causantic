/**
 * Chain walker for episodic retrieval.
 *
 * Walks the causal graph from seed chunks, building ordered narrative chains.
 * Each chain is scored by aggregate cosine similarity per token.
 */

import { getForwardEdges, getBackwardEdges } from '../storage/edge-store.js';
import { getChunkById } from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { angularDistance } from '../utils/angular-distance.js';
import type { StoredChunk, StoredEdge } from '../storage/types.js';

/**
 * Options for chain walking.
 */
export interface ChainWalkerOptions {
  /** Walk direction: backward = recall, forward = predict */
  direction: 'forward' | 'backward';
  /** Maximum tokens across all chains */
  tokenBudget: number;
  /** Query embedding for scoring nodes */
  queryEmbedding: number[];
  /** Maximum depth (hops) per chain. Default: 50. */
  maxDepth?: number;
  /** Filter chunks by agent ID. Non-matching chunks are skipped but edges are still followed. */
  agentFilter?: string;
  /** Max consecutive non-matching agent chunks before abandoning a branch. Default: 5. */
  maxSkippedConsecutive?: number;
}

/**
 * A chain of ordered chunks from graph traversal.
 */
export interface Chain {
  /** Chunk IDs in traversal order */
  chunkIds: string[];
  /** Resolved chunks */
  chunks: StoredChunk[];
  /** Per-node cosine similarity scores (parallel to chunkIds) */
  nodeScores: number[];
  /** Sum of cosine similarity scores for all nodes */
  score: number;
  /** Total token count across all chunks */
  tokenCount: number;
  /** Median per-node similarity (robust to outliers on short chains) */
  medianScore: number;
}

/**
 * Walk causal chains from seed chunks.
 *
 * For each seed, traverses the graph following directed edges.
 * Each branch path produces a separate chain.
 * A global visited set prevents cycles.
 * A running token tally stops traversal when the budget is hit.
 *
 * @param seedIds - Starting chunk IDs
 * @param options - Walk options
 * @returns Array of chains (one per seed that yielded results)
 */
export async function walkChains(seedIds: string[], options: ChainWalkerOptions): Promise<Chain[]> {
  const {
    direction,
    tokenBudget,
    queryEmbedding,
    maxDepth = 50,
    agentFilter,
    maxSkippedConsecutive = 5,
  } = options;

  const visited = new Set<string>();
  let globalTokens = 0;
  const chains: Chain[] = [];

  for (const seedId of seedIds) {
    if (visited.has(seedId) || globalTokens >= tokenBudget) break;

    const chain = await walkSingleChain(
      seedId,
      direction,
      queryEmbedding,
      tokenBudget - globalTokens,
      maxDepth,
      visited,
      agentFilter,
      maxSkippedConsecutive,
    );

    if (chain && chain.chunkIds.length > 0) {
      chains.push(chain);
      globalTokens += chain.tokenCount;
    }
  }

  return chains;
}

/**
 * Walk a single chain from a seed, following edges in one direction.
 *
 * When agentFilter is set, non-matching chunks are skipped (not added to chain
 * output) but their edges are still followed. The branch is abandoned after
 * maxSkippedConsecutive non-matching chunks in a row.
 */
async function walkSingleChain(
  seedId: string,
  direction: 'forward' | 'backward',
  queryEmbedding: number[],
  remainingBudget: number,
  maxDepth: number,
  visited: Set<string>,
  agentFilter?: string,
  maxSkippedConsecutive: number = 5,
): Promise<Chain | null> {
  const chunkIds: string[] = [];
  const chunks: StoredChunk[] = [];
  const nodeScores: number[] = [];
  let score = 0;
  let tokenCount = 0;

  let currentId: string | null = seedId;
  let depth = 0;
  let consecutiveSkips = 0;

  while (currentId && depth < maxDepth && tokenCount < remainingBudget) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const chunk = getChunkById(currentId);
    if (!chunk) break;

    // Agent filter: skip non-matching chunks but still follow their edges
    if (agentFilter && chunk.agentId !== agentFilter) {
      consecutiveSkips++;
      if (consecutiveSkips > maxSkippedConsecutive) break;

      depth++;
      currentId = pickBestEdge(currentId, direction, visited);
      continue;
    }
    consecutiveSkips = 0;

    // Score this node
    const nodeScore = await scoreNode(currentId, queryEmbedding);
    const chunkTokens = chunk.approxTokens || 100;

    if (tokenCount + chunkTokens > remainingBudget && chunkIds.length > 0) break;

    chunkIds.push(currentId);
    chunks.push(chunk);
    nodeScores.push(nodeScore);
    score += nodeScore;
    tokenCount += chunkTokens;
    depth++;

    // Follow highest-weight edge
    currentId = pickBestEdge(currentId, direction, visited);
  }

  if (chunkIds.length === 0) return null;

  return {
    chunkIds,
    chunks,
    nodeScores,
    score,
    tokenCount,
    medianScore: median(nodeScores),
  };
}

/**
 * Pick the unvisited neighbor with the highest initial_weight edge.
 */
function pickBestEdge(
  currentId: string,
  direction: 'forward' | 'backward',
  visited: Set<string>,
): string | null {
  const edges: StoredEdge[] =
    direction === 'forward' ? getForwardEdges(currentId) : getBackwardEdges(currentId);

  let bestId: string | null = null;
  let bestWeight = -Infinity;

  for (const edge of edges) {
    const nextId = direction === 'forward' ? edge.targetChunkId : edge.sourceChunkId;
    if (!visited.has(nextId) && edge.initialWeight > bestWeight) {
      bestWeight = edge.initialWeight;
      bestId = nextId;
    }
  }

  return bestId;
}

/**
 * Score a node by cosine similarity to the query embedding.
 * Returns 1 - angularDistance (so 1 = perfect match, 0 = orthogonal).
 */
async function scoreNode(chunkId: string, queryEmbedding: number[]): Promise<number> {
  const chunkEmbedding = await vectorStore.get(chunkId);
  if (!chunkEmbedding) return 0;
  return 1 - angularDistance(queryEmbedding, chunkEmbedding);
}

/**
 * Select the best chain from a set of candidates.
 * Returns the chain with the highest median per-node score among chains with >= 2 chunks.
 * Returns null if no qualifying chain exists.
 */
export function selectBestChain(chains: Chain[]): Chain | null {
  const qualifying = chains.filter((c) => c.chunkIds.length >= 2);
  if (qualifying.length === 0) return null;

  qualifying.sort((a, b) => b.medianScore - a.medianScore);
  return qualifying[0];
}

/** Compute median of a sorted-copy of values. Returns 0 for empty arrays. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
