# HDBSCAN Implementation

This document explains Causantic's native TypeScript HDBSCAN implementation.

## Background

Causantic needs to cluster thousands of embedding vectors efficiently. The original approach used the npm package `hdbscan-ts`, which had severe performance issues at scale.

### The Problem with hdbscan-ts

The `hdbscan-ts` package has O(n² × k) complexity due to `Array.includes()` calls in its core algorithm:

```javascript
// Problematic pattern in hdbscan-ts
for (const point of points) {           // O(n)
  for (const cluster of clusters) {     // O(k)
    if (cluster.includes(point)) {      // O(n) - Array.includes is linear!
      // ...
    }
  }
}
```

This made clustering 6,000+ points impractical (65+ minutes).

## Native Implementation

Causantic now uses a native TypeScript HDBSCAN implementation with proper data structures:

### Key Optimizations

| Issue | hdbscan-ts | Native Implementation |
|-------|------------|----------------------|
| Point lookup | `Array.includes()` O(n) | `Set.has()` O(1) |
| Memory | JS arrays | Float64Array |
| Union-Find | None | Path compression + rank |
| k-th nearest | Full sort O(n log n) | Quickselect O(n) |
| Core distances | Single-threaded | Parallel (worker_threads) |

### Algorithm Steps

1. **Core Distance Computation**: For each point, find distance to k-th nearest neighbor using quickselect
2. **MST Construction**: Build minimum spanning tree with mutual reachability distances using Prim's algorithm
3. **Condensed Tree**: Process MST edges to build cluster hierarchy
4. **Cluster Extraction**: Use Excess of Mass (EOM) or Leaf method to select stable clusters
5. **Probabilities**: Compute membership probabilities and outlier scores

### Performance

| Dataset Size | hdbscan-ts (old) | Native (new) |
|--------------|------------------|--------------|
| 500 | ~5s | ~0.3s |
| 1,000 | ~30s | ~1s |
| 2,000 | ~3 min | ~4s |
| 6,000 | 65+ min | ~30s |

### Features

The native implementation provides:

- **Cluster labels**: -1 for noise, 0+ for cluster ID
- **Membership probabilities**: 0.0-1.0 confidence for each assignment
- **Outlier scores**: 0.0-1.0 indicating how "outlier-ish" each point is
- **Incremental assignment**: Assign new points without full reclustering
- **EOM and Leaf extraction**: Two cluster selection methods

## Code Location

```
src/clusters/
  hdbscan.ts                    # Main HDBSCAN class
  hdbscan/
    types.ts                    # Type definitions
    min-heap.ts                 # Priority queue for Prim's MST
    union-find.ts               # Disjoint-set with path compression
    core-distance.ts            # k-NN core distance computation
    mst.ts                      # Minimum spanning tree (Prim's)
    hierarchy.ts                # Condensed cluster tree
    cluster-extraction.ts       # Stability-based cluster selection
    probabilities.ts            # Membership probabilities & outlier scores
```

## Configuration

HDBSCAN parameters are set in `causantic.config.json`:

```json
{
  "clustering": {
    "threshold": 0.09,
    "minClusterSize": 4
  }
}
```

- **threshold**: Angular distance threshold for cluster membership (0.09 = ~5° separation)
- **minClusterSize**: Minimum points to form a cluster

## Clustering Quality

The implementation achieves:

- **Precision**: 100% (no false positives)
- **Recall**: 88.7%
- **F1**: 0.940

See [Cluster Threshold Experiments](../experiments/cluster-threshold.md) for validation data.
