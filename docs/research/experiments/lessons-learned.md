# Lessons Learned

This document captures what didn't work during Causantic's development and why.

## Wall-Clock Time Decay

### What We Tried

Decay edge weights based on elapsed wall-clock time:

```typescript
weight = initialWeight * Math.exp(-decayRate * elapsedMs);
```

### What Happened

All historical edges appeared "dead" regardless of relevance:

- Sessions days apart had zero weight
- Returning to a project showed no memory
- Active work was indistinguishable from ancient history

### Why It Failed

Wall-clock time doesn't reflect semantic distance:

- Monday's work and Tuesday's continuation are logically adjacent
- But 24 hours of elapsed time makes them appear distant
- Project switches create artificial time gaps

### The Fix

Hop-based distance (traversal depth / turn count difference) instead of wall-clock time. Logical steps matter, not minutes elapsed.

## Single Decay Curve

### What We Tried

Same decay function for backward and forward edges:

```typescript
weight = 1 - hops / 15; // Linear, same for both directions
```

### What Happened

Either backward or forward retrieval suffered:

- Short decay: Good for backward, poor for forward
- Long decay: Good for forward, poor for backward
- Medium decay: Mediocre for both

### Why It Failed

Backward and forward edges have different semantics:

- **Backward**: "What led to this?" - Relevance fades quickly
- **Forward**: "What resulted from this?" - Consequences persist longer

### The Fix

Direction-specific decay:

- Backward: Linear, dies at 10 hops
- Forward: Delayed linear, 5-hop hold, dies at 20 hops

## JavaScript HDBSCAN at Scale

### What We Tried

Use hdbscan-ts (npm package) for clustering:

```typescript
import { HDBSCAN } from 'hdbscan-ts';
const clusters = new HDBSCAN({ minClusterSize: 4 }).fit(embeddings);
```

### What Happened

Clustering 6,000 points took 65+ minutes, making it impractical.

### Why It Failed

O(n² × k) complexity due to `Array.includes()`:

```typescript
// Problematic code in hdbscan-ts
for (const point of points) {
  for (const cluster of clusters) {
    if (cluster.includes(point)) {
      // O(n) lookup
      // ...
    }
  }
}
```

Array.includes() is O(n), nested in O(n × k) loops.

### The Fix

Native TypeScript implementation with proper data structures:

- `Set.has()` instead of `Array.includes()` for O(1) lookups
- Quickselect for O(n) k-th nearest neighbor
- Union-Find with path compression
- Parallel core distance computation

Result: 30 seconds instead of 65+ minutes for 6,000 points.

See [HDBSCAN Implementation](../approach/hdbscan-performance.md) for details.

## Adjacent Edges as Primary Signal

### What We Tried

Weight adjacent (sequential) edges highest:

```typescript
const edgeWeights = {
  adjacent: 1.0,
  filePath: 0.7,
  topic: 0.5,
};
```

### What Happened

Retrieval precision dropped significantly.

### Why It Failed

Adjacent chunks are often just "next" without semantic relationship:

- "Let me commit this" followed by "Now let's work on X"
- Adjacent in time, unrelated in topic
- High weight pollutes results with noise

### The Fix (Historical → Current)

The initial fix was file-path edges as primary signal (v0.2). The deeper fix in v0.3 was to eliminate all semantic edge types entirely — including adjacent edges. The causal graph now uses purely structural m×n all-pairs edges at D-T-D turn boundaries with topic-shift gating. Semantic association is handled by vector search and clustering instead.

## Greedy Cluster Assignment

### What We Tried

Assign each chunk to nearest cluster centroid:

```typescript
function assignCluster(chunk: Chunk): Cluster {
  return clusters.reduce((best, cluster) =>
    distance(chunk, cluster) < distance(chunk, best) ? cluster : best,
  );
}
```

### What Happened

Clusters grew uncontrollably, mixing unrelated topics.

### Why It Failed

No distance threshold means everything gets assigned:

- Distant outliers join nearest cluster
- Cluster purity degrades
- Topic mixing

### The Fix

Threshold-based assignment:

```typescript
function assignCluster(chunk: Chunk): Cluster | null {
  const nearest = findNearest(chunk, clusters);
  return distance(chunk, nearest) < 0.09 ? nearest : null;
}
```

Chunks beyond threshold remain unclustered (noise).

## Resolved Questions from Pre-Implementation

These questions were identified as open before implementation and resolved through experiments:

| Question                   | Answer                                                   | Evidence                      |
| -------------------------- | -------------------------------------------------------- | ----------------------------- |
| Topic continuity detection | Lexical features (0.998 AUC), 30-min time gap threshold  | Topic continuity experiment   |
| Embedding model selection  | jina-small (0.715 AUC, 0.384 silhouette)                 | Embedding benchmark           |
| Decay curve type           | Delayed linear for retrieval, exponential for prediction | Edge decay experiments        |
| Directional asymmetry      | Yes — +0.64 MRR delta for delayed linear                 | Forward prediction experiment |
| Thinking block handling    | Remove before embedding (+0.063 AUC)                     | Ablation study                |
| Chunk strategy             | Turn-based, code-block aware                             | Parser implementation         |
| Cold start problem         | Not real — full context until compaction                 | Design analysis               |
| Parallelism detection      | Via parentToolUseID + timestamps                         | Session data inspection       |

## Sum-Product Graph Traversal at Scale (v0.3.0)

### What We Tried

Sum-product traversal (inspired by Feynman path integrals) to walk the causal graph. Edge weights multiplied along paths, summed across paths to a node. Direction-specific hop decay curves controlled attenuation.

### What Happened

Collection benchmarks showed graph traversal contributed only ~2% of retrieval results. Augmentation ratio was 1.1× — barely above vector/keyword search alone.

### Why It Failed

Product chains converge to zero too fast. With edge weights in (0,1], a 5-hop path through 0.8-weighted edges yields 0.8⁵ = 0.33. By 10 hops: 0.11. By 15: 0.04. Vector search seeds already have cosine similarity ~0.6-0.8 — path products can't compete. The sum-product mechanism was theoretically elegant but practically dominated by direct vector/keyword hits.

### The Fix

Chain walking replaces graph traversal. Instead of multiplicative path products, the chain walker follows sequential edges and scores each hop independently via cosine similarity against the query. This means a relevant chunk 10 hops away scores just as highly as a relevant chunk 1 hop away — traversal depth doesn't attenuate the signal.

## m×n All-Pairs Edge Topology (v0.3.0)

### What We Tried

Create m×n all-pairs edges at each D-T-D turn boundary. Maximum entropy principle: don't impose false structure, let traversal and decay do the ranking.

### What Happened

Edge counts exploded. A turn boundary with 5 chunks on each side creates 25 edges. Real sessions with 10-20 chunks per turn created hundreds of edges per transition. Most edges connected semantically unrelated chunks.

### Why It Failed

The max-entropy principle is sound in theory — don't assume which edges are important. But in practice, it creates a dense graph where the signal (real causal connections) is buried under noise (spurious edges between unrelated chunks in the same turn). The traversal mechanism couldn't discriminate because all within-chain edges had weight 1.0.

### The Fix

Sequential 1-to-1 edges. Each chunk links to the next chunk in its session, preserving temporal order without the quadratic blowup. Cross-session edges link the last chunk of one session to the first of the next. This creates a simple linked list that chain walking can follow efficiently.

## Separate Semantic and Causal Concerns (v0.3.0)

### The Lesson

The graph's value is **structural ordering** — what came before and after — not **semantic ranking**. Vector search and BM25 are better at "what's relevant to this query." The graph is better at "given something relevant, what's the surrounding narrative?"

This separation of concerns led to the current architecture:

- **Semantic discovery**: Hybrid BM25 + vector search (fast, accurate, query-driven)
- **Structural context**: Chain walking along sequential edges (episodic, narrative, seed-driven)
- **Topic grouping**: HDBSCAN clustering (browsing, organization)

Each mechanism does what it's best at. The v0.2 architecture tried to make the graph do semantic ranking via sum-product path weights — conflating structural and semantic concerns.

## Takeaways

1. **Question assumptions**: Wall-clock time seems natural but is wrong
2. **Test direction-specific behavior**: Backward ≠ forward
3. **Profile at scale**: 100 points ≠ 6,000 points
4. **Semantic over temporal**: Meaning matters more than sequence
5. **Allow noise**: Not everything belongs in a cluster
6. **Measure before theorizing**: Sum-product traversal was theoretically elegant but contributed 2% of results
7. **Separate concerns**: The graph's value is structural ordering, not semantic ranking
8. **Simple beats complex**: 1-to-1 sequential edges outperform m×n all-pairs with sum-product traversal
