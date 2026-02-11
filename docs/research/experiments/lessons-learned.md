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

Vector clock-based hop distance instead of wall-clock time. Logical steps matter, not minutes elapsed.

## Single Decay Curve

### What We Tried

Same decay function for backward and forward edges:

```typescript
weight = 1 - (hops / 15);  // Linear, same for both directions
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
    if (cluster.includes(point)) {  // O(n) lookup
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

### The Fix

File-path edges as primary signal:

```typescript
const edgeWeights = {
  filePath: 1.0,   // Same file = strong relationship
  topic: 0.8,      // Same topic = moderate
  adjacent: 0.5,   // Sequential = weak
};
```

## Greedy Cluster Assignment

### What We Tried

Assign each chunk to nearest cluster centroid:

```typescript
function assignCluster(chunk: Chunk): Cluster {
  return clusters.reduce((best, cluster) =>
    distance(chunk, cluster) < distance(chunk, best) ? cluster : best
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

| Question | Answer | Evidence |
|----------|--------|----------|
| Topic continuity detection | Lexical features (0.998 AUC), 30-min time gap threshold | Topic continuity experiment |
| Embedding model selection | jina-small (0.715 AUC, 0.384 silhouette) | Embedding benchmark |
| Decay curve type | Delayed linear for retrieval, exponential for prediction | Edge decay experiments |
| Directional asymmetry | Yes — +0.64 MRR delta for delayed linear | Forward prediction experiment |
| Thinking block handling | Remove before embedding (+0.063 AUC) | Ablation study |
| Chunk strategy | Turn-based, code-block aware | Parser implementation |
| Cold start problem | Not real — full context until compaction | Design analysis |
| Parallelism detection | Via parentToolUseID + timestamps | Session data inspection |

## Takeaways

1. **Question assumptions**: Wall-clock time seems natural but is wrong
2. **Test direction-specific behavior**: Backward ≠ forward
3. **Profile at scale**: 100 points ≠ 6,000 points
4. **Semantic over temporal**: Meaning matters more than sequence
5. **Allow noise**: Not everything belongs in a cluster
