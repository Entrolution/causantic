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

### With Lazy Pruning

| Metric | Vector-Only | Graph-Augmented | Improvement |
|--------|-------------|-----------------|-------------|
| Augmentation | 1.0x | 3.21x | +221% |
| Precision@10 | 0.72 | 0.81 | +12.5% |
| Coverage | 0.34 | 0.78 | +129% |

### Without Lazy Pruning

| Metric | Vector-Only | Graph-Augmented | Improvement |
|--------|-------------|-----------------|-------------|
| Augmentation | 1.0x | 2.49x | +149% |
| Precision@10 | 0.72 | 0.76 | +5.6% |
| Coverage | 0.34 | 0.62 | +82% |

**Key Finding**: Lazy pruning during traversal improves augmentation from 149% to 221%.

## Traversal Algorithm

```typescript
function traverseGraph(seeds: Chunk[], config: TraversalConfig): Chunk[] {
  const visited = new Set<string>();
  const results: Chunk[] = [];
  const queue: Array<{ chunk: Chunk; depth: number; weight: number }> = [];

  // Initialize with seeds
  for (const seed of seeds) {
    queue.push({ chunk: seed, depth: 0, weight: 1.0 });
  }

  while (queue.length > 0) {
    const { chunk, depth, weight } = queue.shift()!;

    if (visited.has(chunk.id)) continue;
    if (depth > config.maxDepth) continue;
    if (weight < config.minWeight) continue;

    visited.add(chunk.id);
    results.push(chunk);

    // Follow edges with decay
    for (const edge of chunk.edges) {
      const decayedWeight = weight * computeDecay(edge);
      if (decayedWeight >= config.minWeight) {
        queue.push({
          chunk: edge.target,
          depth: depth + 1,
          weight: decayedWeight,
        });
      }
    }
  }

  return results;
}
```

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

| Config | Augmentation | Precision |
|--------|--------------|-----------|
| depth=3, minWeight=0.1 | 1.8x | 0.84 |
| depth=5, minWeight=0.01 | 3.2x | 0.81 |
| depth=7, minWeight=0.001 | 4.1x | 0.72 |

Default (depth=5, minWeight=0.01) balances augmentation and precision.

## Reproducibility

Run the traversal experiments:

```bash
npm run experiments
```

See `src/eval/experiments/` for experiment code.
