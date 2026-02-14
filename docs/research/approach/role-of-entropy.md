# The Role of Entropy

This document explains the information-theoretic principles behind Causantic's causal graph.

> **Updated in v0.3.0**: Sum-product traversal and multiplicative path weights have been **removed**. Chain walking (`chain-walker.ts`) replaced graph traversal — it follows sequential linked-list edges and scores each hop by direct cosine similarity, not multiplicative path products. The information-theoretic analysis below remains historically interesting (it motivated the original graph design), but the "Sum-Product Rules" and "Maximum Entropy Edge Creation" sections describe mechanisms that no longer exist in the codebase. The core insight — that causal structure matters more than wall-clock time — still applies.

## The Core Insight

The central design principle is how **discrimination degrades along causal paths**.

When traversing the graph from a query point, edge weights multiply along the path. As you move farther from the query (more hops), these products converge toward zero. This convergence represents **increasing entropy** — the loss of ability to discriminate between nodes.

```
Query point
    │
    ▼
  [A] ──0.8──▶ [B] ──0.7──▶ [C] ──0.6──▶ [D] ──0.5──▶ [E]
   │            │            │            │            │
   │          0.56         0.34         0.17         0.08
   │            │            │            │            │
   ▼            ▼            ▼            ▼            ▼
  High      Moderate       Low         Very low    Near zero
discrimination                                    (max entropy)
```

**Near the query**: Weights are differentiated — you can meaningfully rank which nodes are more relevant.

**Far from the query**: Weights converge to zero — all distant nodes look equally irrelevant. This is maximum entropy: no discriminative information remains.

## Entropy Flows Along Causal Lines

The key insight is that this entropy increase happens **along causal paths**, not along wall-clock time:

```
Monday 9am:  Work on auth module
Monday 5pm:  Switch to unrelated project
Tuesday 9am: Return to auth module

Wall-clock view:
  24 hours elapsed → appears "old"

Causal view:
  Auth → Auth = 1 hop → still highly discriminated
```

Entropy accumulates through D-T-D transitions (hops), not through seconds. Returning to a topic after days still shows high discrimination if the causal path is short.

## Causal Compression

As edge weights decay and paths attenuate, the graph naturally loses the ability to discriminate distant nodes. This implements **causal compression**:

1. **Near nodes**: High discrimination → preserved in retrieval
2. **Distant nodes**: Low discrimination → effectively pruned
3. **Dead edges**: Zero weight → physically removed

The compression is "causal" because it follows the graph structure, not an external clock. Information that is causally proximate retains discriminative power; information that is causally distant loses it.

## Sum-Product Rules (Historical — v0.2)

> **Removed in v0.3.0**: Sum-product traversal was replaced by chain walking. The traverser, decay functions, and multiplicative path products have been deleted. This section is preserved for research context.

Causantic used a **sum-product** calculation for node weights, analogous to Feynman path integrals in perturbation theory.

### Product Along Paths

Edge weights multiply along a single path. For a path of length *n* with edge weights *w₁, w₂, ..., wₙ*:

```
path_weight = w₁ × w₂ × ... × wₙ
```

Since each weight is in (0,1], the product decreases with path length. After enough hops, all paths have near-zero weight — you cannot distinguish which distant node is "better" because they all score approximately zero.

This is the entropic limit: maximum uncertainty about relevance.

### Sum Across Paths

The total influence between two nodes is the **sum over all paths** connecting them:

```
         ┌──0.8──▶[B]──0.7──┐
[Query]──┤                  ├──▶[Target]
         └──0.5──▶[C]──0.6──┘

Path 1: 0.8 × 0.7 = 0.56
Path 2: 0.5 × 0.6 = 0.30
─────────────────────────
Total:              0.86
```

A node reachable via multiple independent causal paths accumulates influence from each path.

### Cycles Converge Naturally

Unlike graph algorithms that require explicit cycle detection, the sum-product structure **naturally handles cycles** through convergence:

```
[A] ──0.8──▶ [B]
 ▲            │
 │            0.7
 0.4          │
 │            ▼
[D] ◀──0.3── [C]

Paths from A to C:
  Direct:     0.8 × 0.7                    = 0.560
  1 cycle:    0.8 × 0.7 × 0.3 × 0.4 × 0.8 × 0.7 = 0.038
  2 cycles:   ... × (0.3 × 0.4 × 0.8 × 0.7)²    = 0.003
  ...

Series converges: 0.560 + 0.038 + 0.003 + ... ≈ 0.601
```

Since edge weights are <1, each additional cycle multiplies by a factor <1. The series converges geometrically — **no explicit cycle detection needed**.

### Feynman Diagram Analogy

This mirrors perturbation theory in quantum field theory:

| Perturbation Theory | Semantic Graph |
|---------------------|----------------|
| Coupling constant α < 1 | Edge weight ∈ (0,1] |
| Higher-order diagrams suppressed by αⁿ | Longer paths suppressed by w₁×w₂×...×wₙ |
| Sum over all diagrams | Sum over all paths |
| Renormalization handles infinities | Normalisation keeps weights bounded |
| Loop diagrams finite | Cycles attenuate naturally |

Just as Feynman diagrams with more loops contribute less to physical amplitudes (suppressed by powers of α), graph cycles contribute diminishingly to node influence (suppressed by products of weights <1).

## Direction-Specific Entropy

Entropy accumulates differently by traversal direction:

**Backward edges** (historical context): "What caused this?"
- Linear decay, dies at 10 hops
- Discrimination fades quickly into the past
- Recent causes are sharply discriminated; old causes blur together

**Forward edges** (predictive context): "What might follow?"
- Delayed linear, holds for 5 hops, dies at 20 hops
- Immediate predictions stay discriminated longer
- Anticipatory context retains information longer before entropy dominates

## The Graph Is the Clock

A key insight from the design:

> Edge accumulation encodes frequency of co-occurrence, decay encodes recency, and path products encode causal distance. **The graph *is* the clock.**

Traditional systems use external timestamps and apply global decay. Causantic embeds temporal dynamics directly into the graph structure — entropy flows through the graph topology itself.

| Aspect | Traditional | Entropic |
|--------|-------------|----------|
| Time reference | Wall clock | Causal hops |
| Entropy source | Age threshold | Path attenuation |
| Discrimination | Binary (old/new) | Continuous (weight products) |
| Compression | Arbitrary cutoff | Natural convergence to zero |

## Maximum Entropy Edge Creation (Historical — v0.2)

> **Replaced in v0.3.0**: m×n all-pairs edges were replaced by sequential 1-to-1 linked-list edges. The max-entropy principle created O(n²) edges per turn boundary, most between unrelated chunks. See [lessons learned](../experiments/lessons-learned.md) for why this was changed.

When creating edges across a D-T-D transition, Causantic used a **maximum entropy** approach:

```
D₁ (m chunks) → T → D₂ (n chunks)
Creates: m × n edges (all-pairs)
```

We cannot reliably determine which specific input chunk caused which specific output chunk. Rather than impose false structure, Causantic assumes maximum uncertainty and creates all possible causal links. The decay mechanism then naturally builds discrimination over time — frequently reinforced paths stay strong while weak associations fade.

## Practical Implications

The entropic model provides:

1. **Natural ranking**: Nodes are ranked by discriminative weight, not arbitrary thresholds
2. **Graceful degradation**: As you query farther back, results become less differentiated (appropriately uncertain)
3. **Causal relevance**: Discrimination reflects causal proximity, not temporal proximity
4. **Automatic pruning**: Zero-weight edges (maximum local entropy) are removed

## Related

- [Vector Clocks](./vector-clocks.md) - Historical: original causal distance approach (removed in v0.3.0)
- [Decay Models](./decay-models.md) - Implementation of edge weight decay
- [Why Causal Graphs](./why-causal-graphs.md) - Graph structure motivation
