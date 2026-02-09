/**
 * Graph traversal with decay-weighted edges.
 *
 * Uses sum-product rules analogous to Feynman path integrals:
 * - Product: Weights multiply along each path
 * - Sum: Multiple paths to the same node accumulate
 * - Convergence: Cycles naturally attenuate (no explicit detection needed)
 *
 * Since edge weights are in (0,1], path products decrease with length.
 * The minWeight threshold prunes paths that have attenuated below relevance,
 * which naturally handles cycle convergence.
 */

import { getWeightedEdges } from '../storage/edge-store.js';
import { getChunkById } from '../storage/chunk-store.js';
import { getConfig } from '../config/memory-config.js';
import type { DecayModelConfig } from '../eval/experiments/edge-decay/types.js';
import type { WeightedChunk, TraversalResult, EdgeType, StoredChunk } from '../storage/types.js';
import type { VectorClock } from '../temporal/vector-clock.js';

/**
 * Options for graph traversal.
 * Direction-specific decay curves are automatically applied:
 * - Backward: Linear (dies@10) for 4-20 hop range
 * - Forward: Delayed linear (5h, dies@20) for 1-20 hop range
 */
export interface TraversalOptions {
  /** Maximum traversal depth. Default: from config. */
  maxDepth?: number;
  /** Minimum weight threshold. Default: from config. */
  minWeight?: number;
  /** Time-based decay configuration (fallback for edges without vector clocks). */
  decayConfig?: DecayModelConfig;
  /** Traversal direction. Determines which decay curve is used. */
  direction: 'backward' | 'forward';
  /** Reference clock for vector clock-based decay (optional). */
  referenceClock?: VectorClock;
}

/**
 * Traverse the graph from a starting chunk using sum-product rules.
 *
 * Weights multiply along paths (product) and accumulate when multiple
 * paths reach the same node (sum). Cycles are handled naturally by
 * convergence — since weights are <1, cyclic paths attenuate geometrically
 * and are pruned when they fall below minWeight.
 *
 * @param startChunkId - Starting chunk ID
 * @param queryTime - Query time in milliseconds (for decay calculation)
 * @param options - Traversal options
 * @returns Traversal result with weighted chunks
 */
export async function traverse(
  startChunkId: string,
  queryTime: number,
  options: TraversalOptions
): Promise<TraversalResult> {
  const config = getConfig();
  const {
    maxDepth = config.maxTraversalDepth,
    minWeight = config.minSignalThreshold,
    direction,
    referenceClock,
  } = options;

  // Select time-based decay config as fallback (for edges without vector clocks)
  const decayConfig = options.decayConfig ?? (direction === 'backward' ? config.shortRangeDecay : config.forwardDecay);

  // Accumulate weights across all paths (sum rule)
  const accumulatedWeights = new Map<string, number>();
  const minDepths = new Map<string, number>();
  let pathsExplored = 0;

  async function visit(chunkId: string, depth: number, pathWeight: number): Promise<void> {
    // Prune paths that have attenuated below threshold (convergence criterion)
    // Since edge weights are <1, cyclic paths naturally attenuate until pruned
    if (pathWeight < minWeight) return;
    if (depth > maxDepth) return;

    pathsExplored++;

    // Accumulate this path's weight contribution (sum rule)
    const existingWeight = accumulatedWeights.get(chunkId) ?? 0;
    accumulatedWeights.set(chunkId, existingWeight + pathWeight);

    // Track minimum depth for reporting
    const existingDepth = minDepths.get(chunkId) ?? Infinity;
    minDepths.set(chunkId, Math.min(existingDepth, depth));

    // Get weighted edges from this chunk
    const edges = getWeightedEdges(
      chunkId,
      queryTime,
      decayConfig,
      direction,
      referenceClock
    );

    for (const edge of edges) {
      // Compute new path weight (product rule)
      const newWeight = pathWeight * edge.weight;

      // Recursively visit — cycles naturally attenuate via weight products <1
      await visit(edge.targetChunkId, depth + 1, newWeight);
    }
  }

  // Start traversal from the given chunk
  await visit(startChunkId, 0, 1.0);

  // Convert accumulated weights to results
  const results: WeightedChunk[] = [];
  for (const [chunkId, weight] of accumulatedWeights) {
    if (chunkId !== startChunkId) {  // Exclude start node from results
      results.push({
        chunkId,
        weight,
        depth: minDepths.get(chunkId) ?? 0,
      });
    }
  }

  // Sort by weight descending
  results.sort((a, b) => b.weight - a.weight);

  return {
    chunks: results,
    visited: pathsExplored,
  };
}

/**
 * Traverse from multiple starting points and merge results.
 * Useful for starting from vector search results.
 */
export async function traverseMultiple(
  startChunkIds: string[],
  startWeights: number[],
  queryTime: number,
  options: TraversalOptions
): Promise<TraversalResult> {
  // Track all visited and accumulated weights
  const globalWeights = new Map<string, number>();
  const globalDepths = new Map<string, number>();
  let totalVisited = 0;

  for (let i = 0; i < startChunkIds.length; i++) {
    const startId = startChunkIds[i];
    const startWeight = startWeights[i] ?? 1.0;

    // Adjust options with starting weight
    const result = await traverse(startId, queryTime, options);
    totalVisited += result.visited;

    // Merge results, accumulating weights
    for (const chunk of result.chunks) {
      const scaledWeight = chunk.weight * startWeight;
      const existingWeight = globalWeights.get(chunk.chunkId) ?? 0;
      globalWeights.set(chunk.chunkId, existingWeight + scaledWeight);

      // Keep minimum depth
      const existingDepth = globalDepths.get(chunk.chunkId) ?? Infinity;
      globalDepths.set(chunk.chunkId, Math.min(existingDepth, chunk.depth));
    }
  }

  // Convert to array and sort
  const chunks: WeightedChunk[] = [];
  for (const [chunkId, weight] of globalWeights) {
    chunks.push({
      chunkId,
      weight,
      depth: globalDepths.get(chunkId) ?? 0,
    });
  }

  chunks.sort((a, b) => b.weight - a.weight);

  return {
    chunks,
    visited: totalVisited,
  };
}

/**
 * Get chunks with their content from traversal results.
 */
export function resolveChunks(
  traversalResult: TraversalResult
): Array<{ chunk: StoredChunk; weight: number; depth: number }> {
  const resolved: Array<{ chunk: StoredChunk; weight: number; depth: number }> = [];

  for (const wc of traversalResult.chunks) {
    const chunk = getChunkById(wc.chunkId);
    if (chunk) {
      resolved.push({
        chunk,
        weight: wc.weight,
        depth: wc.depth,
      });
    }
  }

  return resolved;
}

/**
 * Deduplicate and re-rank weighted chunks.
 * Combines duplicate entries and applies additional scoring.
 */
export function dedupeAndRank(chunks: WeightedChunk[]): WeightedChunk[] {
  const byId = new Map<string, WeightedChunk>();

  for (const chunk of chunks) {
    const existing = byId.get(chunk.chunkId);
    if (existing) {
      // Combine weights (sum with diminishing returns)
      existing.weight = existing.weight + chunk.weight * 0.5;
      // Keep minimum depth
      existing.depth = Math.min(existing.depth, chunk.depth);
    } else {
      byId.set(chunk.chunkId, { ...chunk });
    }
  }

  const deduped = Array.from(byId.values());
  deduped.sort((a, b) => b.weight - a.weight);

  return deduped;
}
