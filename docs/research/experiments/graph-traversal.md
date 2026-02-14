# Graph Traversal Experiments

This document details experiments on graph-augmented retrieval.

> **Historical Document (v0.2)**: This experiment used sum-product traversal with m×n all-pairs edges. Both were removed in v0.3.0 — replaced by chain walking with sequential 1-to-1 edges. The traverser (`traverser.ts`), decay functions (`decay.ts`), and pruner (`pruner.ts`) have been deleted. Collection benchmarks showed graph traversal contributing only ~2% of results, motivating the redesign. The experimental data below remains valid as a record of the v0.2 architecture's measured performance.

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
| Augmentation | 1.0× | 3.88× | 3.88× |
| Avg Chunks Added | 10 | 28.8 | 2.88× |
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
function visit(chunkId: string, depth: number, pathWeight: number): void {
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
  const edges = getWeightedEdges(chunkId, queryTime, decayConfig, direction);

  for (const edge of edges) {
    // Compute new path weight (product rule)
    const newWeight = pathWeight * edge.weight;
    // Recursively visit — cycles naturally attenuate via weight products <1
    visit(edge.targetChunkId, depth + 1, newWeight);
  }
}
```

See [The Role of Entropy](/docs/research/approach/role-of-entropy.md) for the theoretical foundation.

## Edge Type Effectiveness (Historical, pre-v0.3)

> This data was collected with the original 9 semantic edge types. Since v0.3, edges use 2 structural roles (within-chain, cross-session) with sequential 1-to-1 topology.

| Edge Type | Augmentation Contribution |
|-----------|--------------------------|
| file-path | 48% |
| adjacent | 31% |
| topic | 15% |
| cross-session | 6% |

File-path edges were the most valuable for finding related context under the semantic model. The v0.3 structural model replaces all edge types with sequential within-chain edges — the graph provides structural ordering (what came before/after), while vector+keyword search handles relevance ranking.

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

## v0.3 Results: Chain Walking Augmentation

v0.3.0 replaced sum-product graph traversal with **chain walking** — following sequential edges backward/forward from vector search seeds to build ordered narrative chains. The cross-project experiment was re-run with the same methodology to allow direct comparison.

### Cross-Project Chain Walking (297 queries, 15 projects)

| Metric | v0.2 (sum-product) | v0.3 (chain walking) |
|--------|-------------------|---------------------|
| Weighted Average Augmentation | 4.65× | **2.46×** |
| Queries | 492 | 297 |
| Projects | 25 | 15 |
| Queries producing chains | N/A | 100% |
| Mean chain length | N/A | 3.8 chunks |

### Why the Number Dropped

The v0.2 4.65× figure counted all chunks reachable through m×n edges via sum-product traversal — including chunks only distantly related to the query. The v0.3 2.46× counts additional unique chunks found by walking sequential chains from the same vector seeds.

Key differences:
1. **Fewer edges**: Sequential linked-list (7,631 edges) vs m×n all-pairs (19,338 edges)
2. **Ordered output**: Chain walking produces chronologically ordered narratives, not ranked scores
3. **Quality over quantity**: Chain chunks are sequentially connected to seeds, not just reachable through any path

### What Chain Walking Actually Provides

The 2.46× number understates the value because it measures the same thing as v0.2 (additional chunks found). Chain walking's real contribution is **episodic ordering** — turning a bag of ranked results into a coherent narrative. The collection benchmark captures this better:

| Metric | Value |
|--------|-------|
| Chain coverage | 97% of queries produce episodic chains |
| Mean chain length | 4.3 chunks per narrative |
| Token efficiency | 127% (returned context is relevant) |
| p95 recall latency | 3,314ms (down from 16,952ms) |
| Fallback rate | 3% (fall back to search-style results) |

### Conclusion

Chain walking provides meaningful context augmentation (2.46×) with dramatically better latency and coherent output ordering. The graph's value is structural (what came before/after), not semantic (what's similar) — a separation of concerns that the benchmark results validate.

## Reproducibility

Run the chain walking experiment:

```bash
npx tsx scripts/experiments/cross-project-experiment.ts
```

Run the collection benchmark:

```bash
npx causantic benchmark-collection --full
```

See `src/eval/experiments/` and `src/eval/collection-benchmark/` for experiment code.
