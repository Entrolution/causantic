/**
 * Graph traversal with decay-weighted edges.
 * Traverses the chunk graph following edges while applying temporal decay.
 * Supports both time-based decay (legacy) and vector clock-based decay.
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
 * Traverse the graph from a starting chunk.
 * Follows edges while applying decay weights.
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

  const visited = new Set<string>();
  const results: WeightedChunk[] = [];

  async function visit(chunkId: string, depth: number, pathWeight: number): Promise<void> {
    // Check termination conditions
    if (depth > maxDepth) return;
    if (visited.has(chunkId)) return;
    if (pathWeight < minWeight) return;

    visited.add(chunkId);

    // Get weighted edges from this chunk
    // Direction-specific decay curves are applied automatically based on edge type
    const edges = getWeightedEdges(
      chunkId,
      queryTime,
      decayConfig,
      direction,
      referenceClock
    );

    for (const edge of edges) {
      // Compute new path weight
      const newWeight = pathWeight * edge.weight;

      // Add to results if above threshold
      if (newWeight >= minWeight) {
        results.push({
          chunkId: edge.targetChunkId,
          weight: newWeight,
          depth: depth + 1,
        });

        // Recursively visit
        await visit(edge.targetChunkId, depth + 1, newWeight);
      }
    }
  }

  // Start traversal from the given chunk
  await visit(startChunkId, 0, 1.0);

  // Sort by weight descending
  results.sort((a, b) => b.weight - a.weight);

  return {
    chunks: results,
    visited: visited.size,
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
