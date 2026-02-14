# Decay Models

This document explains Causantic's approach to edge weight decay.

## The Problem

Memory edges become less relevant with distance from the query, but how do we model this decay?

### Naive Approach: Wall-Clock Time

The obvious approach is to decay edges based on elapsed time:

```typescript
// DON'T DO THIS
function timeDecay(edge: Edge, now: Date): number {
  const ageMs = now.getTime() - edge.createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / 30);  // Dies after 30 days
}
```

**Problem**: This fails catastrophically for development work:
- Sessions may be days apart but semantically adjacent
- Work pauses (weekends, vacations) shouldn't kill edges
- A bug fix 2 weeks later is still relevant to the original code

### Our Approach: Hop-Based Decay

Causantic measures distance in "hops" — the traversal depth from the query ingress point in the causal graph:

```typescript
function hopDecay(hops: number, config: HopDecayConfig): number {
  // Exponential: steep initial drop, long tail
  return Math.pow(config.weightPerHop, hops);
}
```

The graph topology already encodes causality by construction. When traversing from an ingress node, the traversal depth IS the causal distance — no external clocking mechanism needed.

## Why Hops Work Better

### Logical vs Physical Time

```
Wall-clock time:           Logical hops:

Day 1: Auth work           Chunk A (auth)
Day 2: Weekend                 ↓
Day 3: Weekend             Chunk B (auth bug)
Day 4: Auth bug fix            ↓
                           Chunk C (auth test)

Time-based: 3 days apart   Hop-based: 2 hops apart
Weight: 0.9 (mostly dead)  Weight: 0.76 (still relevant)
```

### Compaction-Based Ingestion

Chunks are ingested at compaction, not continuously. The query ingress on the causal graph is at the last compaction point, not the current conversation turn. This means the distance metric must be based on graph structure, not session-relative position.

## Direction-Specific Decay

A key finding from the v0.3 experiments: backward and forward edges need fundamentally different treatment, but not for the reasons originally assumed.

### Backward Edges (Historical Context)

"What led to this?" — The empirical reference rate curve shows two regimes:

```
Empirical reference rate by hop distance (30 sessions, 5,505 references):

  Hop 1:     100% ████████████████████████████████████████
  Hop 2-3:    12% █████
  Hop 4-6:    11% ████
  Hop 7-10:    9% ████
  Hop 11-20:   8% ███
  Hop 21+:     3% █
```

**Key insight**: 88% drop from hop 1→2, then a long slow tail. Exponential decay matches this naturally.

**Configuration**: Exponential, half-life ~5 hops, effective range ~30

```
Weight
1.0 │●
    │ ●
    │  ●
0.5 │    ●
    │       ●
    │           ●
0.1 │                    ●
0.0 │                              ●
    ├──────────────────────────────────
    0     5     10    20    30     Hops
```

**What was validated**:
- No hold period — hold periods hurt backward MRR (0.423 vs 0.985) by creating ties at short range
- Strictly monotonic — all strictly monotonic models score identically (ρ=1.0 with reference rate)
- Long range needed — previous linear dies@10 killed real signal at 11-30 hops (3-9% reference rate)

### Forward Edges (Predictive Context)

"What might come next?" — Experiments showed all 9 decay models produce identical forward prediction MRR at every distance stratum (0.992 overall, 0.372 non-adjacent, 0.365 long-range).

**Key insight**: Forward decay shape is irrelevant. Only monotonicity matters.

**Configuration**: Simple linear, dies at ~30 hops

```
Weight
1.0 │●
    │  ●
    │    ●
0.5 │        ●
    │            ●
    │                ●
0.0 │                      ●
    ├──────────────────────────
    0     5     10    20   30  Hops
```

**Why simple linear**: Since shape doesn't matter (experimentally confirmed), the simplest monotonic function wins. No hold period — experimentally confirmed zero benefit for forward prediction.

## Experimental Evidence

### What matters (high impact)

1. **Monotonicity**: All strictly monotonic models score MRR=0.985 backward, 0.992 forward
2. **Effective range**: Must extend to 30+ hops — references exist at 21+ hops (3% rate)
3. **No hold period for backward**: Creates ties at short range, drops MRR by 57%

### What doesn't matter (low impact)

1. **Exact curve shape**: Linear, exponential, power-law all perform identically when strictly monotonic
2. **Forward curve shape**: All 9 models identical at every stratum
3. **Hold periods for forward**: Confirmed zero benefit

### The real insight

Decay curves are most important at short range (1-3 hops) for discrimination. At long range (>5 hops), content relevance dominates — the graph topology and vector/keyword search do the heavy lifting. Decay just needs to be monotonic and not kill the signal.

## Code Reference (Historical — v0.2)

> **Removed in v0.3.0**: `src/storage/decay.ts` has been deleted. Hop-based decay curves and the traverser that used them (`src/retrieval/traverser.ts`) were removed when sum-product traversal was replaced by chain walking. The chain walker (`src/retrieval/chain-walker.ts`) scores each hop by direct cosine similarity against the query — no decay functions needed.

The v0.2 implementation was in `src/storage/decay.ts`:

```typescript
// Backward: Exponential (half-life ~5 hops, effective range ~30)
export const BACKWARD_HOP_DECAY: HopDecayConfig = {
  type: 'exponential',
  weightPerHop: 0.87,
  minWeight: 0.01,
};

// Forward: Linear (dies at ~30 hops)
export const FORWARD_HOP_DECAY: HopDecayConfig = {
  type: 'linear',
  decayPerHop: 0.033,
  minWeight: 0.01,
};
```

## Related

- [Decay Curves Experiments](./decay-curves.md) - Full experimental data and methodology
- [Lessons Learned](../experiments/lessons-learned.md) - Why sum-product traversal and decay were removed
