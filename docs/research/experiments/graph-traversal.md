# Graph Traversal Experiments

This document details experiments on graph-augmented retrieval.

## Hypothesis

Graph traversal from vector search results can find additional relevant context that pure vector search misses.

## Methodology

### Dataset

- 75 sessions with known file-path relationships
- Queries targeting specific implementation details
- Ground truth: all chunks referencing the same file

### Metrics

- **Augmentation Ratio**: Additional relevant chunks found / initial seeds
- **Precision@K**: Fraction of top K results that are relevant
- **Coverage**: Fraction of all relevant chunks found

### Comparison

1. **Vector-only**: Top-K similar chunks
2. **Graph-augmented**: Vector seeds + graph traversal

## Results

### Cross-Project Experiment (492 queries, 25 sessions)

| Metric | Value |
|--------|-------|
| Weighted Average Augmentation | **4.65×** |
| Median | 4.54× |
| Range | 3.60× - 5.87× |
| Total Chunks | 6,243 |
| Total Queries | 492 |

**Key Finding**: Graph-augmented retrieval consistently provides 4-6× the context vs vector search alone, with even the worst-performing session achieving 3.60× augmentation.

### Single-Project Baseline (10 queries)

| Metric | Vector-Only | Graph-Augmented | Improvement |
|--------|-------------|-----------------|-------------|
| Augmentation | 1.0x | 3.88x | +288% |
| Avg Chunks Added | 10 | 28.8 | +188% |
| Paths Explored | — | 239 | — |

### Depth Sweep Results

| maxDepth | Chunks Added | Augmentation | Efficiency |
|----------|--------------|--------------|------------|
| 3 | 13.8 | 2.38x | 0.279 |
| 5 | 20.5 | 3.05x | 0.166 |
| 7 | 23.9 | 3.39x | 0.138 |
| 10 | 25.7 | 3.57x | 0.122 |
| 15 | 28.7 | 3.87x | 0.120 |
| 20 | 28.8 | 3.88x | 0.121 |

- **Diminishing returns** start at depth=15 (< 1% gain per depth unit after)
- **Recommended**: maxDepth=20 matches forward decay (dies at 20 hops)

## Traversal Algorithm

The traverser uses **sum-product rules** inspired by Feynman diagrams:
- **Product rule**: Weights multiply along paths (w₁ × w₂ × ... × wₙ)
- **Sum rule**: Multiple paths to a node contribute additively

Cycles converge naturally since edge weights are < 1, so cyclic paths attenuate geometrically until pruned by minWeight.

```typescript
async function visit(chunkId: string, depth: number, pathWeight: number): Promise<void> {
  // Prune paths that have attenuated below threshold (convergence criterion)
  // Since edge weights are <1, cyclic paths naturally attenuate until pruned
  if (pathWeight < minWeight) return;
  if (depth > maxDepth) return;

  // Accumulate this path's weight contribution (sum rule)
  const existingWeight = accumulatedWeights.get(chunkId) ?? 0;
  accumulatedWeights.set(chunkId, existingWeight + pathWeight);

  // Track minimum depth for reporting
  const existingDepth = minDepths.get(chunkId) ?? Infinity;
  minDepths.set(chunkId, Math.min(existingDepth, depth));

  // Get weighted edges from this chunk
  const edges = getWeightedEdges(chunkId, queryTime, decayConfig, direction, referenceClock);

  for (const edge of edges) {
    // Compute new path weight (product rule)
    const newWeight = pathWeight * edge.weight;
    // Recursively visit — cycles naturally attenuate via weight products <1
    await visit(edge.targetChunkId, depth + 1, newWeight);
  }
}
```

See [Why Entropic?](/docs/research/approach/why-entropic.md) for the theoretical foundation.

## Lazy Pruning

Dead edges (weight = 0) are removed during traversal:

```typescript
// During traversal
if (computeDecay(edge) <= 0) {
  markForDeletion(edge);  // Prune later
  continue;
}
```

This provides two benefits:
1. Faster traversal (skip dead edges)
2. Automatic cleanup (no separate maintenance pass)

## Edge Type Effectiveness

| Edge Type | Augmentation Contribution |
|-----------|--------------------------|
| file-path | 48% |
| adjacent | 31% |
| topic | 15% |
| cross-session | 6% |

File-path edges are the most valuable for finding related context.

## Configuration Impact

### minWeight Sweep (fixed depth=20)

| minWeight | Chunks Added | Augmentation |
|-----------|--------------|--------------|
| 0.1 | 8.9 | 1.89x |
| 0.05 | 19.9 | 2.99x |
| 0.01 | 28.8 | 3.88x |
| 0.005 | 28.8 | 3.88x |
| 0.001 | 28.8 | 3.88x |

**Finding**: minWeight=0.01 captures all reachable context. Lower thresholds add computational cost without benefit.

### Default Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| maxDepth | 20 | Matches forward decay (dies at 20 hops) |
| minWeight | 0.01 | Captures full context without noise |

## Reproducibility

Run the traversal experiments:

```bash
npm run experiments
```

See `src/eval/experiments/` for experiment code.
