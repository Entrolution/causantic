# Decay Curve Experiments

This document details the experiments that determined Causantic's optimal decay curves.

## Experiment History

### v0.2 (Original)

The original experiments measured decay performance using hop distance (originally via vector clocks) on 75 sessions (9,361 file-path references). Those results established direction-specific decay curves.

### v0.3 (Current)

Re-ran experiments with hop-based distance (turn count difference) on 30 sessions (5,505 references across all reference types). Fixed correlation methodology and added stratified forward prediction analysis.

## Hypothesis

Edge weights should decay based on logical hop distance (turn count difference), and backward/forward edges may need different decay profiles.

## Methodology

### Dataset

- 30 Claude Code sessions (1,542 total turns)
- 5,505 detected references
- Reference types (pre-v0.3 semantic types): file-path (2,274), code-entity (1,640), adjacent (1,155), explicit-backref (291), error-fragment (145)
- Confidence: high (2,419), medium (1,931), low (1,155)

> **Note**: Since v0.3, edge types were simplified to 4 structural roles (within-chain, cross-session, brief, debrief). The reference type distribution above is historical. The decay curve results remain valid — they measure hop-distance decay behavior, which is independent of edge type classification.

### Metrics

- **MRR** (Mean Reciprocal Rank): Position of first correct result
- **Spearman correlation (ρ)**: Rank correlation between model decay weights and empirical reference rates
- **Stratified MRR**: MRR computed at different hop-distance strata

### Models Tested

9 preset models:

1. **Simple Linear**: `weight = 1 - d/20`, dies at 20 hops
2. **Delayed Linear**: 3-hop hold, then linear decay, dies at ~23 hops
3. **Multi-Linear (Default)**: 3-tier sum (short/medium/long), effective range ~50 hops
4. **Multi-Linear (Fast)**: Fast-decaying tiers, effective range ~15 hops
5. **Multi-Linear (Slow)**: Slow-decaying tiers, effective range ~70 hops
6. **Exponential**: half-life ~5 hops, asymptotic
7. **Exponential (Slow)**: half-life ~13 hops, asymptotic
8. **Power Law (α=1)**: `weight = 1.5 / (1 + 0.5d)`, asymptotic
9. **Power Law (α=2)**: `weight = 1.25 / (1 + 0.5d)²`, steep initial, asymptotic

## Key Finding: Empirical Reference Rate Curve

The ground truth from 30 sessions reveals two distinct regimes:

| Hop Distance | Turn Pairs | Reference Rate | Normalized |
|-------------|-----------|----------------|------------|
| 1 hop | 1,512 | 1.150 | 100% |
| 2-3 hops | 2,934 | 0.136 | 12% |
| 4-6 hops | 4,176 | 0.126 | 11% |
| 7-10 hops | 5,148 | 0.102 | 9% |
| 11-20 hops | 10,815 | 0.093 | 8% |
| 21+ hops | 41,785 | 0.031 | 3% |

**Two regimes**:
1. **Steep initial drop** (hop 1 → 2): 88% loss — adjacent turns are overwhelmingly the most referenced
2. **Long slow tail** (hop 2 → 21+): gradual decline from 12% to 3% — references exist at all distances

> Note: Reference rate > 1.0 at hop 1 because multiple reference types can fire for the same turn pair (e.g., file-path AND code-entity for the same turn).

## Results: Backward Retrieval

### Overall MRR

| Model | MRR | Rank@1 | Rank@2-5 | Rank@6+ |
|-------|-----|--------|----------|---------|
| Simple Linear | 0.985 | 1,479 | 25 | 8 |
| Multi-Linear (Fast) | **0.985** | **1,479** | 25 | 8 |
| Multi-Linear (Default) | 0.985 | 1,479 | 25 | 8 |
| Exponential | 0.985 | 1,479 | 25 | 8 |
| Exponential (Slow) | 0.985 | 1,479 | 25 | 8 |
| Power Law (α=1) | 0.985 | 1,479 | 25 | 8 |
| Power Law (α=2) | 0.985 | 1,479 | 25 | 8 |
| Delayed Linear | 0.423 | 188 | 1,316 | 8 |
| Multi-Linear (Slow) | 0.423 | 188 | 1,316 | 8 |

**Key finding**: All strictly monotonic models score identically (MRR=0.985). Models with hold periods (Delayed Linear, Multi-Linear Slow) score dramatically worse (0.423) because the plateau at short range creates ties that prevent ranking the nearest turn first.

### Hop-Distance Correlation (ρ)

| Model | Spearman ρ |
|-------|-----------|
| Simple Linear | **1.000** |
| Multi-Linear (Default) | **1.000** |
| Exponential | **1.000** |
| Power Law (α=1, α=2) | **1.000** |
| Delayed Linear | 0.943 |
| Multi-Linear (Slow) | 0.943 |

All strictly monotonic models achieve perfect correlation with the empirical reference rate curve. Hold periods break monotonicity and reduce correlation.

### Stratified Analysis (Backward)

| Stratum | Refs | Best Model | MRR | Rank@1 |
|---------|------|------------|-----|--------|
| All references | 5,505 | Multi-Linear (Fast) | 0.985 | 98% |
| Non-adjacent (>1 hop) | 3,766 | Delayed Linear | 0.693 | 56% |
| Mid-range (>3 hops) | 3,366 | Multi-Linear (Fast) | 0.208 | 0% |
| Long-range (>5 hops, high conf) | 1,753 | Multi-Linear (Fast) | 0.142 | 0% |
| Very long-range (>10 hops) | 2,315 | Multi-Linear (Fast) | 0.088 | 0% |

**Critical insight**: At >3 hops, all models converge to ~0.2 MRR. At >10 hops, best is 0.088. **Decay curves alone cannot identify which specific distant turn is relevant.** Long-range retrieval requires content-based search (vector/keyword), not distance-based decay.

## Results: Forward Prediction

### Stratified Forward MRR

| Stratum | Queries | MRR | Rank@1 |
|---------|---------|-----|--------|
| All (≥1 hop) | 1,496 | 0.992 | 99% |
| Non-adjacent (≥2 hops) | 891 | 0.372 | 18% |
| Mid-range (≥4 hops) | 830 | 0.376 | 19% |
| Long-range (≥6 hops) | 767 | 0.365 | 18% |

**All 9 models produce identical forward MRR at every stratum.** This is because:
1. Candidate future turns have unique integer hop distances
2. All models are monotonically decreasing
3. So all models produce the same ranking: closest candidate first
4. The decay curve **shape** is irrelevant for forward prediction

## Direction-Specific Decay

### Why backward and forward need different treatment

| Property | Backward | Forward |
|----------|----------|---------|
| Shape matters? | Partially — no hold period | No — any monotonic function |
| Best model type | Exponential (steep initial, long tail) | Simple linear (minimal complexity) |
| Hold period? | Hurts discrimination (0.423 vs 0.985 MRR) | No effect (all models identical) |
| Effective range | ~30 hops (references exist at 21+) | ~30 hops (match backward) |
| Key insight | Steep-then-tail matches empirical reference rate | Only monotonicity matters |

## Production Configuration

Based on these experiments:

```typescript
// Backward: Exponential (half-life ~5 hops, effective range ~30)
export const BACKWARD_HOP_DECAY: HopDecayConfig = {
  type: 'exponential',
  weightPerHop: 0.87,  // half-life ~5 hops
  minWeight: 0.01,     // effective range ~30 hops
};

// Forward: Simple linear (dies@30)
export const FORWARD_HOP_DECAY: HopDecayConfig = {
  type: 'linear',
  decayPerHop: 0.033,  // dies at ~30 hops
  minWeight: 0.01,
};
```

### Backward: Exponential rationale

| Hops | Weight | Empirical Ref Rate |
|------|--------|--------------------|
| 1 | 0.87 | 1.150 (100%) |
| 3 | 0.66 | 0.136 (12%) |
| 5 | 0.50 | 0.126 (11%) |
| 10 | 0.25 | 0.102 (9%) |
| 20 | 0.06 | 0.093 (8%) |
| 30 | 0.015 | 0.031 (3%) |

- Steep initial drop matches the 88% reference rate decline at hop 2
- Long asymptotic tail preserves signal at 20-30 hops where 3-9% of references occur
- Previous linear dies@10 killed all signal beyond 10 hops, losing real references

### Forward: Linear rationale

- Shape doesn't matter (experimentally confirmed) — simple is better
- No hold period (experimentally confirmed zero benefit)
- Extended to 30 hops to match backward effective range

## Meta-Insights

1. **Decay curves are most important at short range (1-3 hops)** where they provide strong discrimination between candidates
2. **At long range (>5 hops), content relevance dominates** — vector/keyword search does the heavy lifting, decay just needs to not kill the signal
3. **The graph topology is the main filter** — edges only exist between causally related chunks, so the traversal is already content-filtered. Decay attenuates distant signals to prevent noise accumulation
4. **Monotonicity is the essential property** — all strictly monotonic models perform identically. The exact curve shape matters far less than the effective range

## Reproducibility

Run the experiments:

```bash
npm run edge-decay-experiments
```

Results are saved to `benchmark-results/`.

Experiment source: `src/eval/experiments/edge-decay/`
