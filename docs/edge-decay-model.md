# Edge Decay Model for D-T-D Graphs

> Design document for temporal edge weight decay in Document-Turn-Document causal graphs

**Status**: Design phase
**Last updated**: 2026-02-06

---

## Overview

In the D-T-D (Document-Turn-Document) model, edges represent causal relationships between conversation turns. Edge weights should decay over time to model relevance — older context becomes less immediately relevant to current queries. This document explores decay curve options and proposes a multi-linear approach.

---

## Problem Statement

When querying the D-T-D graph at time `t_query`, edge weights determine which historical context is most relevant. We need a decay function `w(t)` where:

- `w(0) = w₀` (initial weight at edge creation)
- `w(t)` decreases as time `t` increases
- At some point, the edge should be pruned (weight reaches threshold or zero)

### Requirements

1. **Natural topology management**: Edges should eventually be removed without arbitrary thresholds
2. **Tunable timescales**: Different edge types may need different decay rates
3. **Computational efficiency**: Weight calculation at query time should be fast
4. **No query state**: Weight depends only on edge creation time and query time
5. **Entropic pressure control**: Predictable memory pressure for graph management

---

## Decay Curve Options

### 1. Exponential Decay

```
w(t) = w₀ * exp(-k * t)
```

**Pros**:
- Matches Ebbinghaus forgetting curve (cognitive science basis)
- Smooth, continuous decay
- Single parameter `k` controls decay rate

**Cons**:
- Asymptotic approach to zero — never actually reaches zero
- Requires arbitrary threshold for pruning (`w < ε → prune`)
- Threshold is a tuning burden and feels ad-hoc

### 2. Linear Decay

```
w(t) = w₀ - k * t
w(t) = max(0, w₀ - k * t)  // with floor
```

**Pros**:
- Deterministic zero-crossing: `t_death = w₀ / k`
- Natural topology pruning — edge dies when `w ≤ 0`
- Computationally trivial
- Predictable memory pressure

**Cons**:
- Doesn't model the "long tail" of memory
- Single linear decay may be too simple
- Decay rate is constant regardless of edge age

### 3. Multi-Linear Decay (Proposed)

Parallel ensemble of linear decays with different rates:

```
w(t) = Σᵢ max(0, wᵢ - kᵢ * t)
```

Where each component represents a different "memory tier":
- **Short-term**: High initial weight, fast decay
- **Medium-term**: Moderate weight, moderate decay
- **Long-term**: Lower weight, slow decay

**Pros**:
- Approximates smooth curves via superposition
- Natural zero-crossing for topology management
- Explicit control over multiple timescales
- Tunable degrees of freedom (2N parameters for N tiers)
- Computationally simple (sum of linear terms)

**Cons**:
- More parameters to tune than single exponential
- Need to determine tier weights and rates empirically

### 4. Delayed Linear Decay

```
w(t) = w₀                       if t < τ_hold
w(t) = w₀ - k * (t - τ_hold)    if t ≥ τ_hold
```

**Pros**:
- Models "working memory" — full relevance for holding period
- Recent context is fully available, not just mostly available
- Single additional parameter `τ_hold`

**Cons**:
- Discontinuity in derivative at `t = τ_hold`
- Still single decay rate after hold period

### 5. Power Law Decay

```
w(t) = w₀ * (1 + t)^(-α)
```

**Pros**:
- Evidence from ACT-R cognitive architecture that memory retrieval follows power law
- Long tail — decays faster initially, then slower
- May better match empirical relevance patterns

**Cons**:
- Asymptotic like exponential (needs threshold)
- More complex computation than linear

---

## Proposed Model: Multi-Linear with Delayed Onset

Combine parallel tiers with optional hold periods:

```typescript
interface DecayTier {
  /** Initial weight contribution from this tier */
  initialWeight: number;
  /** Time (ms) before decay begins */
  holdPeriodMs: number;
  /** Decay rate (weight units per ms) */
  decayRatePerMs: number;
}

function tierWeight(tier: DecayTier, ageMs: number): number {
  if (ageMs < tier.holdPeriodMs) {
    return tier.initialWeight;
  }
  const decayTime = ageMs - tier.holdPeriodMs;
  return Math.max(0, tier.initialWeight - tier.decayRatePerMs * decayTime);
}

function totalEdgeWeight(tiers: DecayTier[], ageMs: number): number {
  return tiers.reduce((sum, tier) => sum + tierWeight(tier, ageMs), 0);
}
```

### Default Tier Configuration

| Tier | Initial Weight | Hold Period | Decay Rate | Death Time |
|------|---------------|-------------|------------|------------|
| Short-term | 1.0 | 5 min | 0.001/ms | ~22 min |
| Medium-term | 0.5 | 1 hour | 0.0001/ms | ~2.4 hours |
| Long-term | 0.3 | 24 hours | 0.00001/ms | ~32 hours |

**Combined characteristics**:
- Peak weight at creation: 1.8
- After 5 min: ~1.78 (short-term starts decaying)
- After 1 hour: ~1.0 (medium-term starts decaying)
- After 24 hours: ~0.3 (only long-term remains)
- Full death: ~56 hours (when long-term reaches zero)

### Why This Configuration

1. **Short-term (minutes)**: Captures immediate conversational context. High weight because recent turns are almost certainly relevant.

2. **Medium-term (hours)**: Captures session-level context. Important for multi-hour coding sessions where earlier decisions inform later work.

3. **Long-term (days)**: Captures project-level context. Architectural decisions, key insights that remain relevant across sessions.

---

## Edge Lifecycle

### Creation
When a causal edge is created (e.g., user turn references previous assistant output):

```typescript
interface Edge {
  sourceId: string;      // Source chunk/turn
  targetId: string;      // Target chunk/turn
  createdAt: number;     // Unix timestamp ms
  tiers: DecayTier[];    // Decay configuration
}
```

### Query-Time Weight Calculation
At query time `t_query`:

```typescript
function getEdgeWeight(edge: Edge, queryTime: number): number {
  const ageMs = queryTime - edge.createdAt;
  return totalEdgeWeight(edge.tiers, ageMs);
}
```

### Pruning
Edge is pruned when total weight ≤ 0:

```typescript
function shouldPrune(edge: Edge, queryTime: number): boolean {
  return getEdgeWeight(edge, queryTime) <= 0;
}
```

Pruning can happen:
- **Lazily**: During traversal, skip edges with zero weight
- **Eagerly**: Background process periodically removes dead edges
- **In-situ**: At query time, remove edge if weight is zero

### Node Orphan Detection
When an edge is pruned, check if connected nodes are orphaned:

```typescript
async function pruneEdgeAndCleanup(edge: Edge, graph: Graph): Promise<void> {
  graph.removeEdge(edge);

  // Check if source/target nodes are now orphaned
  for (const nodeId of [edge.sourceId, edge.targetId]) {
    const hasEdges = graph.hasAnyEdges(nodeId);
    if (!hasEdges) {
      graph.removeNode(nodeId);
      await vectorStore.removeChunk(nodeId);
    }
  }
}
```

---

## Reinforcement (Deferred)

The current proposal does **not** include reinforcement on access. This is intentional:

1. **Complexity**: Adding edges on access could cause topology explosion
2. **State management**: Would require tracking access times
3. **Unclear semantics**: What does "access" mean for an edge?

If reinforcement is needed later, options include:
- Reset hold period on access (extend plateau)
- Boost weight by fixed amount (accumulation)
- Create new short-term tier contribution

---

## Comparison with Exponential

### Multi-Linear Advantages

| Aspect | Multi-Linear | Exponential |
|--------|--------------|-------------|
| Zero-crossing | Deterministic | Asymptotic (needs threshold) |
| Topology management | Natural | Requires threshold tuning |
| Computation | Sum of linear | Requires exp() |
| Timescales | Explicit tiers | Single decay constant |
| Tunability | 2N params (N tiers) | 1-2 params |

### When Exponential Might Be Better

- If empirical data shows smooth exponential decay is a better fit
- If single-parameter simplicity is valued over tunability
- If reinforcement with multiplicative boost is desired

---

## Open Questions

### 1. Tier Configuration
Should tier parameters be:
- Global constants?
- Per-edge-type (e.g., different for code vs. discussion)?
- Learned from data?

### 2. Directionality
Does relevance decay differ for:
- **Forward queries**: "What context led to this turn?"
- **Backward queries**: "What turns were informed by this context?"

### 3. Edge Type Weighting
Should initial weights vary by edge type?
- Tool result → higher initial weight?
- Topic continuation → moderate weight?
- Explicit reference → highest weight?

### 4. Empirical Validation
How do we measure whether a decay curve "works"?
- Retrieval precision/recall at different time offsets
- User satisfaction with retrieved context
- Comparison of retrieved vs. actually-referenced content

---

## Next Steps

1. ~~**Simulate decay curves**: Visualize composite curves for different tier configurations~~ ✓ Done
2. ~~**Design experiments**: Test which decay profiles best predict relevance in real sessions~~ ✓ Done
3. ~~**Implement reference extractor**: Parse sessions to identify turn-to-turn references~~ ✓ Done
4. ~~**Run experiments**: Execute relevance decay validation on real session data~~ ✓ Done
5. **Implement prototype**: Add decay calculation to D-T-D graph implementation
6. **Iterate on parameters**: Tune based on empirical results (delayed linear or multi-linear slow recommended)

---

## Experiment Design: Relevance Decay Validation

### Objective

Determine which decay curve best predicts whether older context is actually relevant to later queries. The key insight: we can extract ground-truth relevance signals from session data and test whether decay models rank actually-relevant context higher than non-relevant context.

### Ground Truth Extraction

From session data, identify when a turn explicitly or implicitly references earlier context:

| Signal | Detection Method | Relevance Label |
|--------|------------------|-----------------|
| **Explicit file reference** | User mentions same file as earlier assistant output | Strong relevance |
| **Tool result reference** | User refers to error/output from previous tool use | Strong relevance |
| **Continuation markers** | "yes", "the error", "that works" | Moderate relevance |
| **Topic continuity** | Same semantic topic (embedding similarity) | Moderate relevance |
| **Time adjacency** | Within same session, no topic shift | Weak relevance |
| **Topic shift** | Explicit "new question" or large time gap | No relevance |

### Experiment 1: Decay-Weighted Retrieval Ranking

**Hypothesis**: A good decay model should rank actually-referenced turns higher than non-referenced turns at query time.

**Method**:
1. For each user turn at time `t_user`, identify which previous assistant turns it references
2. Compute decay weight for all candidate turns: `w(t_user - t_assistant)`
3. Rank candidates by decay weight
4. Measure whether referenced turns appear higher in ranking

**Metric**: Mean Reciprocal Rank (MRR) of actually-referenced turns

```
MRR = (1/N) * Σ (1 / rank_of_first_relevant)
```

### Experiment 2: Time-Offset Correlation

**Hypothesis**: Decay weight should correlate with actual reference probability at different time offsets.

**Method**:
1. Bin turn pairs by time offset: 0-5min, 5-30min, 30min-1h, 1-4h, 4-24h, 1-7d
2. For each bin, compute:
   - Actual reference rate (% of pairs where later turn references earlier)
   - Mean decay weight from each model
3. Compute correlation between decay weight and reference rate

**Metric**: Spearman rank correlation between decay weight and reference rate

### Experiment 3: Forward vs. Backward Queries

**Hypothesis**: Relevance decay may differ based on query direction.

**Forward query**: "What context led to this turn?" (looking backward in time)
**Backward query**: "What turns were informed by this context?" (looking forward in time)

**Method**:
1. For forward queries: Given turn T, which earlier turns influenced it?
2. For backward queries: Given turn T, which later turns reference it?
3. Evaluate decay models separately for each direction
4. Test whether separate decay parameters improve prediction

### Experiment 4: Session Type Stratification

**Hypothesis**: Decay patterns may differ between coding sessions and non-coding sessions.

**Method**:
1. Segment sessions into types: coding (high tool use), discussion (low tool use), mixed
2. Run Experiments 1-3 separately for each type
3. Compare optimal decay parameters across types

**Session types available**:
- Coding: Ultan, apolitical-assistant, cdx-core, etc.
- Non-coding: pde-book, Personal-advice, analytic-methods-in-pde

### Experiment 5: Decay Parameter Optimization

**Hypothesis**: We can find optimal tier parameters by maximizing retrieval quality.

**Method**:
1. Define parameter search space for multi-linear tiers
2. For each parameter configuration, run Experiment 1
3. Find configuration that maximizes MRR
4. Compare to preset configurations

**Search space**:
```
Short-term hold: [1, 5, 15, 30] minutes
Short-term decay rate: [5, 15, 30, 60] minutes to death
Medium-term hold: [30, 60, 120, 240] minutes
Medium-term decay rate: [2, 4, 8, 24] hours to death
Long-term hold: [4, 12, 24, 48] hours
Long-term decay rate: [1, 3, 7, 14] days to death
```

### Implementation Plan

1. **Reference extractor**: Parse sessions to identify turn-to-turn references
2. **Decay scorer**: Apply decay models to score candidate turns
3. **Evaluation harness**: Compute MRR, correlation, stratified metrics
4. **Parameter optimizer**: Grid search over decay configurations

### Expected Outcomes

| Outcome | Implication |
|---------|-------------|
| Multi-linear >> exponential | Multi-linear's explicit timescales better match actual relevance patterns |
| Multi-linear ≈ exponential | Simpler exponential may suffice |
| Forward ≠ backward | Need separate decay profiles for query direction |
| Coding ≠ non-coding | Need session-type-specific parameters |
| Optimal params ≠ presets | Current presets need tuning |

### Simulation Results (Preliminary)

From `npm run edge-decay-sim`:

| Model | Peak | @ 1h | @ 24h | @ 7d | Death |
|-------|------|------|-------|------|-------|
| Multi-Linear (Default) | 1.8 | 0.8 | 0.3 | 0 | 3d |
| Multi-Linear (Slow) | 1.5 | 1.3 | 0.5 | 0.14 | 17d |
| Exponential (1h half-life) | 1.8 | 0.9 | ~0 | ~0 | never |
| Power Law (α=1) | 1.8 | 0.9 | 0.07 | 0.01 | never |

The Multi-Linear (Slow) model maintains the most "memory" over time (highest AUC), which may be appropriate for knowledge-building sessions but excessive for ephemeral task execution.

---

## Experiment Results (Comprehensive)

**Run**: 2026-02-06, 75 sessions, 3,209 turns, 9,361 references

### Key Insight: Context Window Matters

The critical finding is that **optimal decay model depends on what context Claude already has**. For immediate retrieval (previous turn), recency dominates. But for long-range retrieval (what the memory system actually needs), slower decay with hold periods wins.

### Stratified Analysis by Context Distance

| Context Boundary | Best Model | MRR | Rank@1 |
|------------------|------------|-----|--------|
| All references (baseline) | Exponential | 0.961 | 95% |
| **Beyond immediate (>1 turn)** | **Delayed Linear** | **0.680** | 55% |
| **Beyond recent (>3 turns)** | **Delayed Linear** | **0.549** | 42% |
| **Beyond session (>30 min)** | **Multi-Linear (Default)** | **0.397** | 18% |
| **Long-range (>5 turns, high conf)** | **Delayed Linear** | **0.420** | 29% |

### Model Comparison for Long-Range Retrieval (>3 turns)

| Model | MRR | vs Exponential |
|-------|-----|----------------|
| **Delayed Linear** | **0.549** | **+45%** |
| Multi-Linear (Slow) | 0.538 | +42% |
| Multi-Linear (Default) | 0.412 | +9% |
| Simple Linear | 0.382 | +1% |
| Exponential | 0.378 | baseline |

### Why Hold Periods Matter

The **hold period** is the key differentiator for long-range retrieval:

1. **Exponential decay drops too quickly** — by the time context is outside Claude's window, the weight is near zero
2. **Delayed Linear maintains weight** during hold period, then decays linearly to death
3. **Multi-Linear (Slow) distributes weight** across multiple timescales, keeping some relevance even for old context

### Recommended Configuration

For the memory system's primary use case (retrieving context beyond Claude's immediate window):

```typescript
// Recommended: Delayed Linear with extended hold
const MEMORY_RETRIEVAL_CONFIG: DecayModelConfig = {
  type: 'delayed-linear',
  initialWeight: 1.0,
  holdPeriodMs: 30 * MS_PER_MINUTE,  // Full weight for 30 min
  decayRate: 1.0 / (4 * MS_PER_HOUR), // Then decay over 4 hours
};

// Alternative: Multi-Linear for topology management
const TOPOLOGY_CONFIG: DecayModelConfig = {
  type: 'multi-linear',
  tiers: [
    { name: 'session', initialWeight: 0.6, holdPeriodMs: 30 * MS_PER_MINUTE, decayRatePerMs: 0.6 / (2 * MS_PER_HOUR) },
    { name: 'project', initialWeight: 0.4, holdPeriodMs: 4 * MS_PER_HOUR, decayRatePerMs: 0.4 / (24 * MS_PER_HOUR) },
  ],
};
```

### Reference Type Distribution

| Type | Count | % |
|------|-------|---|
| file-path | 4,172 | 44.6% |
| adjacent (weak) | 2,263 | 24.2% |
| code-entity | 2,118 | 22.6% |
| explicit-backref | 601 | 6.4% |
| error-fragment | 207 | 2.2% |

### Conclusions

1. **For retrieval ranking**: Use delayed linear or multi-linear slow — hold periods significantly improve long-range MRR
2. **For topology management**: Multi-linear provides deterministic death times without arbitrary thresholds
3. **Exponential is suboptimal** for memory systems — it decays too quickly for long-range retrieval
4. **The 30-minute hold period** aligns well with typical session boundaries

---

## References

- Ebbinghaus, H. (1885). Memory: A Contribution to Experimental Psychology
- Anderson, J. R., & Schooler, L. J. (1991). Reflections of the environment in memory. Psychological Science
- Wickelgren, W. A. (1974). Single-trace fragility theory of memory dynamics. Memory & Cognition
