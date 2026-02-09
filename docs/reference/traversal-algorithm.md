# Traversal Algorithm Reference

ECM uses a sum-product traversal algorithm inspired by Feynman path integrals to navigate the causal memory graph.

## Overview

The algorithm explores paths through the graph from one or more starting chunks, accumulating weights using two rules:

| Rule | Description |
|------|-------------|
| **Product** | Weights multiply along each path |
| **Sum** | Multiple paths to the same node accumulate |

This naturally handles cycles without explicit detection — since edge weights are in (0,1], cyclic paths attenuate geometrically until pruned.

## Core Algorithm

```typescript
async function traverse(
  startChunkId: string,
  queryTime: number,
  options: TraversalOptions
): Promise<TraversalResult>
```

### Pseudocode

```
function traverse(start, queryTime, options):
    accumulated = Map<chunkId, weight>()
    minDepths = Map<chunkId, depth>()

    function visit(chunkId, depth, pathWeight):
        if pathWeight < minWeight: return  // Prune attenuated paths
        if depth > maxDepth: return         // Depth limit

        // Sum rule: accumulate this path's contribution
        accumulated[chunkId] += pathWeight
        minDepths[chunkId] = min(minDepths[chunkId], depth)

        // Get outgoing edges with decay-computed weights
        edges = getWeightedEdges(chunkId, queryTime, options)

        for edge in edges:
            // Product rule: multiply weights along path
            newWeight = pathWeight × edge.weight
            visit(edge.targetChunkId, depth + 1, newWeight)

    visit(start, depth=0, pathWeight=1.0)

    return sort(accumulated, by=weight, descending=true)
```

## Sum-Product Semantics

### Product Rule

Weights multiply along each path. This models the intuition that connections become weaker as you travel further:

```
Path: A → B → C → D
      1.0 × 0.8 × 0.7 × 0.6 = 0.336

Each hop reduces the signal strength.
```

### Sum Rule

When multiple paths reach the same node, their weights add:

```
Path 1: A → B → D  (weight: 0.8 × 0.9 = 0.72)
Path 2: A → C → D  (weight: 0.7 × 0.8 = 0.56)

Total weight for D: 0.72 + 0.56 = 1.28
```

This means nodes reachable via multiple paths are more relevant — they're "well-connected" in the graph.

## Convergence and Cycle Handling

The algorithm handles cycles naturally without explicit detection:

```
Consider a cycle: A → B → C → A → B → ...

With edge weights ~0.7:
  First pass through A→B: 0.7
  After one cycle:        0.7 × 0.7 × 0.7 × 0.7 = 0.24
  After two cycles:       0.24 × 0.24 = 0.058
  ...eventually: < minWeight threshold → pruned
```

Since all weights are in (0,1], cyclic paths attenuate geometrically. The `minWeight` threshold (default: 0.001) prunes paths that have attenuated below relevance.

## Direction-Specific Traversal

Traversal direction determines which edges to follow and which decay curve to use:

### Backward Traversal

"What led to this?" — Follows `backward` edges to find historical context.

```typescript
const result = await traverse(startChunkId, Date.now(), {
  direction: 'backward',
  maxDepth: 10,
});
```

**Decay curve**: Linear, dies at 10 hops

### Forward Traversal

"What comes next?" — Follows `forward` edges for predictive context.

```typescript
const result = await traverse(startChunkId, Date.now(), {
  direction: 'forward',
  maxDepth: 20,
});
```

**Decay curve**: Delayed linear, 5-hop hold, dies at 20 hops

## Multi-Start Traversal

For vector search results, traverse from multiple starting points:

```typescript
const result = await traverseMultiple(
  startChunkIds,   // ['chunk-1', 'chunk-2', 'chunk-3']
  startWeights,    // [0.95, 0.87, 0.82]  // From vector similarity
  queryTime,
  options
);
```

Each start's contribution is scaled by its starting weight, then accumulated:

```
Start 1 (weight 0.95): reaches D with weight 0.72
Start 2 (weight 0.87): reaches D with weight 0.56

D's total weight: 0.95 × 0.72 + 0.87 × 0.56 = 1.17
```

## Deduplication and Re-ranking

After traversal, `dedupeAndRank()` combines duplicate entries:

```typescript
function dedupeAndRank(chunks: WeightedChunk[]): WeightedChunk[] {
  // Combine weights with diminishing returns
  existing.weight = existing.weight + chunk.weight * 0.5;

  // Keep minimum depth
  existing.depth = Math.min(existing.depth, chunk.depth);

  // Sort by weight descending
  return chunks.sort((a, b) => b.weight - a.weight);
}
```

The 0.5 factor for additional paths prevents over-weighting highly-connected nodes.

## Configuration

### TraversalOptions

```typescript
interface TraversalOptions {
  maxDepth?: number;      // Default: from config (typically 10-20)
  minWeight?: number;     // Default: from config (typically 0.001)
  direction: 'backward' | 'forward';
  decayConfig?: DecayModelConfig;  // Fallback for time-based decay
  referenceClock?: VectorClock;    // For hop-based decay
}
```

### Memory Config

```json
{
  "maxTraversalDepth": 10,
  "minSignalThreshold": 0.001,
  "shortRangeDecay": {
    "type": "linear",
    "diesAtHops": 10
  },
  "forwardDecay": {
    "type": "delayed-linear",
    "holdHops": 5,
    "diesAtHops": 20
  }
}
```

## Performance Characteristics

| Aspect | Behavior |
|--------|----------|
| Time complexity | O(E × D) where E = edges, D = max depth |
| Space complexity | O(V) where V = unique chunks visited |
| Parallelism | Single-threaded recursive traversal |
| Memory | Accumulates all visited chunks in memory |

### Optimizations

1. **Early pruning**: Paths below `minWeight` are not explored
2. **Depth limit**: Hard cap on traversal depth
3. **Dead edge filtering**: Edges with weight ≤ 0 are excluded

## Comparison to Other Algorithms

### vs. PageRank

- PageRank: Iterative matrix computation, global ranking
- ECM: Query-time traversal, local to starting points

### vs. BFS/DFS

- BFS/DFS: Unweighted, visits each node once
- ECM: Weighted, visits nodes via multiple paths (accumulating)

### vs. Dijkstra

- Dijkstra: Finds shortest path (min)
- ECM: Accumulates all paths (sum-product)

## Example Walkthrough

Given this graph:

```
     ┌──0.9──→ B ──0.8──┐
     │                   ↓
A ───┤                   D
     │                   ↑
     └──0.7──→ C ──0.6──┘
```

Starting at A with direction=backward:

1. Visit A (depth=0, weight=1.0)
2. Visit B (depth=1, weight=0.9)
3. Visit C (depth=1, weight=0.7)
4. Visit D via B (depth=2, weight=0.9×0.8=0.72)
5. Visit D via C (depth=2, weight=0.7×0.6=0.42, accumulated)

**Result**:
```
D: weight=1.14 (0.72+0.42), depth=2
B: weight=0.9, depth=1
C: weight=0.7, depth=1
```

## Related

- [Storage API](./storage-api.md) - Edge and chunk storage
- [Decay Models](../research/approach/decay-models.md) - How edge weights decay
- [Vector Clocks](../research/approach/vector-clocks.md) - Hop distance measurement
- [Graph Traversal Experiments](../research/experiments/graph-traversal.md) - Experimental results
