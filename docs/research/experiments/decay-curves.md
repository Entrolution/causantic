# Decay Curve Experiments

This document details the experiments that determined Causantic's optimal decay curves.

## Hypothesis

Edge weights should decay based on logical (hop) distance rather than wall-clock time, and backward/forward edges may need different decay profiles.

## Methodology

### Dataset

- 75 Claude Code sessions
- 9,361 file-path references
- Known ground truth for same-file retrieval

### Metrics

- **MRR** (Mean Reciprocal Rank): Position of first correct result
- **Recall@K**: Fraction of correct results in top K

### Models Tested

1. **Exponential (time-based)**: `weight = e^(-λ * time)`
2. **Linear (hop-based)**: `weight = 1 - (hops / diesAtHops)`
3. **Delayed Linear**: `weight = 1.0` for `holdHops`, then linear decay

## Results: Backward Edges

Backward edges point to historical context ("what came before").

| Model | MRR | Recall@5 |
|-------|-----|----------|
| Exponential (time) | 0.509 | 0.62 |
| Linear (dies@5) | 0.621 | 0.71 |
| Linear (dies@10) | **0.688** | **0.78** |
| Linear (dies@15) | 0.654 | 0.75 |
| Linear (dies@20) | 0.612 | 0.72 |

**Winner**: Linear decay, dies at 10 hops (1.35× MRR vs exponential)

### Interpretation

- 10 hops provides the best balance between recency and history
- Too short (5 hops): Misses relevant older context
- Too long (20 hops): Dilutes signal with noise

## Results: Forward Edges

Forward edges point to future context ("what came after").

| Model | MRR | Recall@5 |
|-------|-----|----------|
| Exponential (time) | 0.229 | 0.31 |
| Linear (dies@10) | 0.412 | 0.52 |
| Linear (dies@20) | 0.567 | 0.68 |
| Delayed (0h, dies@20) | 0.623 | 0.72 |
| Delayed (5h, dies@20) | **0.849** | **0.91** |
| Delayed (10h, dies@20) | 0.801 | 0.87 |

**Winner**: Delayed linear, 5-hop hold, dies at 20 (3.71× MRR vs exponential)

### Interpretation

- Forward edges benefit from a "hold period" of full weight
- Immediate consequences (next 5 hops) are almost always relevant
- Longer tail (20 hops) captures extended effects
- 5-hop hold is optimal; longer holds reduce discrimination

## Direction-Specific Decay

The key finding: **backward and forward edges need different decay profiles**.

| Direction | Best Model | Rationale |
|-----------|------------|-----------|
| Backward | Linear, dies@10 | Historical context fades quickly |
| Forward | Delayed (5h, dies@20) | Consequences are immediate but persist |

## Decay Curves Visualization

```
Weight
1.0 ├─────────────────────────────
    │ ╲            Forward (delayed)
    │  ╲   ─────────────╲
0.5 │   ╲                 ╲
    │    ╲ Backward        ╲
    │     ╲                  ╲
0.0 ├─────┴──────────────────┴────
    0     5     10    15    20    Hops
```

## Code Reference

Implementation in `src/storage/decay.ts`:

```typescript
export const BACKWARD_HOP_DECAY = {
  type: 'linear',
  diesAtHops: 10,
};

export const FORWARD_HOP_DECAY = {
  type: 'delayed-linear',
  holdHops: 5,
  diesAtHops: 20,
};
```

## Reproducibility

Run the decay experiments:

```bash
npm run edge-decay-experiments
npm run hop-decay-shapes
```

Results are saved to `benchmark-results/edge-decay/`.
