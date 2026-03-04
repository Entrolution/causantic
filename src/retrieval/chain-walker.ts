/**
 * Chain walker for episodic retrieval.
 *
 * Walks the causal graph from seed chunks, building ordered narrative chains.
 * Each chain is scored by aggregate cosine similarity per token.
 *
 * Uses multi-path DFS with backtracking: at branching points, all paths are
 * explored and emitted as candidates. selectBestChain() picks the winner.
 */

import { getForwardEdges, getBackwardEdges } from '../storage/edge-store.js';
import { getChunkById } from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { angularDistance } from '../utils/angular-distance.js';
import type { StoredChunk } from '../storage/types.js';

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
  /** Max candidate chains per seed. Default: 10. */
  maxCandidatesPerSeed?: number;
  /** Max DFS node expansions per seed. Default: 200. */
  maxExpansionsPerSeed?: number;
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
 * Walk causal chains from seed chunks using multi-path DFS.
 *
 * For each seed, explores all reachable paths via DFS with backtracking.
 * Each seed uses an independent visited set — no cross-seed interference.
 * All candidate chains are returned for selectBestChain() to choose from.
 *
 * @param seedIds - Starting chunk IDs
 * @param options - Walk options
 * @returns Array of candidate chains from all seeds
 */
export async function walkChains(seedIds: string[], options: ChainWalkerOptions): Promise<Chain[]> {
  const {
    direction,
    tokenBudget,
    queryEmbedding,
    maxDepth = 50,
    agentFilter,
    maxSkippedConsecutive = 5,
    maxCandidatesPerSeed = 10,
    maxExpansionsPerSeed = 200,
  } = options;

  const allCandidates: Chain[] = [];

  for (const seedId of seedIds) {
    const seedCandidates = await walkAllPaths(
      seedId,
      direction,
      queryEmbedding,
      tokenBudget,
      maxDepth,
      maxCandidatesPerSeed,
      maxExpansionsPerSeed,
      agentFilter,
      maxSkippedConsecutive,
    );
    allCandidates.push(...seedCandidates);
  }

  return allCandidates;
}

/**
 * Multi-path DFS from a single seed. Returns all candidate chains found.
 *
 * Uses mutable path state with push/pop backtracking. Per-path visited set
 * prevents cycles within a path while allowing different paths to share nodes.
 */
async function walkAllPaths(
  seedId: string,
  direction: 'forward' | 'backward',
  queryEmbedding: number[],
  tokenBudget: number,
  maxDepth: number,
  maxCandidates: number,
  maxExpansions: number,
  agentFilter?: string,
  maxSkippedConsecutive: number = 5,
): Promise<Chain[]> {
  const candidates: Chain[] = [];
  const scoreCache = new Map<string, number>();
  let expansions = 0;

  const seedChunk = getChunkById(seedId);
  if (!seedChunk) return [];

  async function scoreMemo(id: string): Promise<number> {
    if (!scoreCache.has(id)) {
      scoreCache.set(id, await scoreNode(id, queryEmbedding));
    }
    return scoreCache.get(id)!;
  }

  // Mutable path state (push/pop for backtracking)
  const pathChunkIds: string[] = [];
  const pathChunks: StoredChunk[] = [];
  const pathScores: number[] = [];
  let pathScore = 0;
  let pathTokens = 0;
  const pathVisited = new Set<string>();

  function emitCandidate(): void {
    if (pathChunkIds.length === 0) return;
    candidates.push({
      chunkIds: [...pathChunkIds],
      chunks: [...pathChunks],
      nodeScores: [...pathScores],
      score: pathScore,
      tokenCount: pathTokens,
      medianScore: median(pathScores),
    });
  }

  async function dfs(currentId: string, depth: number, consecutiveSkips: number): Promise<void> {
    if (++expansions > maxExpansions || candidates.length >= maxCandidates) return;

    const edges =
      direction === 'forward' ? getForwardEdges(currentId) : getBackwardEdges(currentId);

    const unvisited = edges.filter((e) => {
      const nextId = direction === 'forward' ? e.targetChunkId : e.sourceChunkId;
      return !pathVisited.has(nextId);
    });

    // Terminal: dead end or depth limit — emit
    if (unvisited.length === 0 || depth >= maxDepth) {
      emitCandidate();
      return;
    }

    let anyChildEmitted = false;

    for (const edge of unvisited) {
      if (expansions > maxExpansions || candidates.length >= maxCandidates) return;

      const nextId = direction === 'forward' ? edge.targetChunkId : edge.sourceChunkId;
      const chunk = getChunkById(nextId);
      if (!chunk) continue;

      pathVisited.add(nextId);

      // Agent filter: skip non-matching but follow edges
      if (agentFilter && chunk.agentId !== agentFilter) {
        const newSkips = consecutiveSkips + 1;
        if (newSkips <= maxSkippedConsecutive) {
          await dfs(nextId, depth + 1, newSkips);
          anyChildEmitted = true;
        }
        pathVisited.delete(nextId);
        continue;
      }

      const chunkTokens = chunk.approxTokens || 100;

      // Oversized chunk (exceeds total budget on its own): pass through without
      // adding to path. The chain doesn't break — we continue traversing — but
      // this node won't appear in the output or affect the median score.
      if (chunkTokens > tokenBudget) {
        await dfs(nextId, depth + 1, 0);
        anyChildEmitted = true;
        pathVisited.delete(nextId);
        continue;
      }

      const nodeScore = await scoreMemo(nextId);

      // Token budget: emit current path, don't extend
      if (pathTokens + chunkTokens > tokenBudget && pathChunkIds.length > 0) {
        emitCandidate();
        pathVisited.delete(nextId);
        anyChildEmitted = true;
        continue;
      }

      // Push onto path
      pathChunkIds.push(nextId);
      pathChunks.push(chunk);
      pathScores.push(nodeScore);
      pathScore += nodeScore;
      pathTokens += chunkTokens;

      await dfs(nextId, depth + 1, 0);
      anyChildEmitted = true;

      // Pop (backtrack)
      pathChunkIds.pop();
      pathChunks.pop();
      pathScores.pop();
      pathScore -= nodeScore;
      pathTokens -= chunkTokens;
      pathVisited.delete(nextId);
    }

    // If no child branch emitted anything (all filtered/skipped), emit current path
    if (!anyChildEmitted) {
      emitCandidate();
    }
  }

  // Initialize with seed (oversized seeds are traversed but excluded from path)
  const seedTokens = seedChunk.approxTokens || 100;

  pathVisited.add(seedId);
  if (seedTokens <= tokenBudget) {
    const seedScore = await scoreMemo(seedId);
    pathChunkIds.push(seedId);
    pathChunks.push(seedChunk);
    pathScores.push(seedScore);
    pathScore = seedScore;
    pathTokens = seedTokens;
  }

  await dfs(seedId, 1, 0);

  // If DFS produced no candidates (expansion budget exhausted before any terminal), emit current
  if (candidates.length === 0 && pathChunkIds.length > 0) {
    emitCandidate();
  }

  return candidates;
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
