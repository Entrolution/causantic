# Cluster Threshold Experiments

This document details the experiments that determined ECM's optimal clustering threshold.

## Hypothesis

Angular distance threshold affects clustering quality. There exists an optimal threshold that maximizes precision and recall for same-cluster predictions.

## Methodology

### Dataset

- 6,000+ chunks with embeddings
- Known topic labels for validation
- Same-topic pairs as ground truth

### Metrics

- **Precision**: Fraction of predicted same-cluster pairs that are correct
- **Recall**: Fraction of actual same-topic pairs found
- **F1**: Harmonic mean of precision and recall

### Approach

1. Run HDBSCAN at various thresholds
2. For each chunk, check if assigned cluster matches topic label
3. Calculate precision/recall for same-cluster predictions

## Results

| Threshold | Precision | Recall | F1 |
|-----------|-----------|--------|-----|
| 0.05 | 1.000 | 0.712 | 0.832 |
| 0.07 | 1.000 | 0.823 | 0.903 |
| 0.09 | **1.000** | **0.887** | **0.940** |
| 0.11 | 0.982 | 0.901 | 0.940 |
| 0.13 | 0.954 | 0.923 | 0.938 |
| 0.15 | 0.921 | 0.945 | 0.933 |

**Winner**: Threshold 0.09 (F1=0.940, 100% precision, 88.7% recall)

## Analysis

### Why 0.09?

```
Threshold too low (< 0.07):
- High precision (clusters are pure)
- Low recall (many chunks left unclustered)
- Over-fragmentation

Threshold too high (> 0.13):
- High recall (most chunks assigned)
- Lower precision (clusters become impure)
- Topic mixing

Threshold 0.09:
- Perfect precision (no false positives)
- Good recall (most topics captured)
- Optimal F1
```

### Trade-off Curve

```
Precision
1.0 │ ●───●───●──●
    │              ╲
0.9 │               ●──●
    │
0.8 │
    ├──────────────────────
    0.05  0.09  0.13     Threshold
```

## Angular Distance

ECM uses angular (cosine-based) distance:

```typescript
function angularDistance(a: number[], b: number[]): number {
  const similarity = cosineSimilarity(a, b);
  return Math.acos(Math.max(-1, Math.min(1, similarity))) / Math.PI;
}
```

Range: 0 (identical) to 1 (opposite)

## HDBSCAN Configuration

```typescript
const hdbscanConfig = {
  minClusterSize: 4,
  metric: 'angular',
  clusterSelectionEpsilon: 0.09,
};
```

## Cluster Assignment

Chunks are assigned to clusters based on centroid distance:

```typescript
function assignToCluster(chunk: Chunk, clusters: Cluster[]): Cluster | null {
  let bestCluster = null;
  let bestDistance = threshold;  // 0.09

  for (const cluster of clusters) {
    const distance = angularDistance(chunk.embedding, cluster.centroid);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCluster = cluster;
    }
  }

  return bestCluster;  // null if no cluster within threshold
}
```

## Reproducibility

Run the clustering experiments:

```bash
npm run cluster-threshold
```

Results are saved to `benchmark-results/clustering/`.
