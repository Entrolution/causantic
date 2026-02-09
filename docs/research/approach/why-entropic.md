# Why "Entropic"?

This document explains the thermodynamic inspiration behind the name "Entropic Causal Memory."

## The Core Insight

The name "Entropic" reflects a fundamental design principle: **memory decay flows along causal lines, not along a global clock**.

In thermodynamics, entropy increases along the arrow of time within a causal system. ECM applies this principle to memory: edges decay based on *causal distance* (measured in D-T-D hops), not wall-clock time. This mirrors how entropy propagates through a system — it follows causal pathways, not an external temporal reference.

## Causal Compression

Edge weight decay implements a form of **causal compression**:

```
High weight edges:
  Recent in causal terms → Likely relevant → Preserved

Low weight edges:
  Distant in causal terms → Unlikely relevant → Pruned
```

As edges decay and eventually die, the graph naturally compresses. This isn't arbitrary deletion — it's *entropic pressure* that preferentially removes causally distant information while preserving causally proximate context.

The compression is "causal" because:
1. Decay is measured in **hops** (D-T-D transitions), not seconds
2. Edges die when they're causally stale, not temporally old
3. Returning to a topic after days still shows high relevance if the causal chain is short

## Entropy Flows Along Causal Lines

Consider this scenario:

```
Monday 9am:  Work on authentication module
Monday 5pm:  Switch to unrelated project
Tuesday 9am: Return to authentication module

Wall-clock view:
  Monday 9am → Tuesday 9am = 24 hours (seems old)

Causal view:
  Auth chunk → Auth chunk = 1 hop (still fresh)
```

Wall-clock decay would treat Tuesday's work as "old" because 24 hours elapsed. But causally, it's a direct continuation — only one logical step removed.

ECM's vector clocks track **logical time** (D-T-D cycles per thought stream), not physical time. Entropy accumulates along causal paths:

```typescript
function hopCount(edgeClock: VectorClock, refClock: VectorClock): number {
  let hops = 0;
  for (const agentId of Object.keys(edgeClock)) {
    // Only shared entries contribute — entropy flows along active causal lines
    hops += Math.max(0, (refClock[agentId] ?? 0) - edgeClock[agentId]);
  }
  return hops;
}
```

## The Graph Is the Clock

A key insight from the feasibility study:

> Edge accumulation encodes frequency of co-occurrence, decay encodes recency, and path products encode causal distance. **The graph *is* the clock.**

Traditional systems use external timestamps and apply global decay. ECM embeds temporal dynamics directly into the graph structure:

| Aspect | Traditional | Entropic |
|--------|-------------|----------|
| Time reference | Wall clock | Causal hops |
| Decay trigger | Seconds elapsed | D-T-D transitions |
| Relevance measure | Recency | Causal proximity |
| Compression driver | Age threshold | Entropic pressure |

## Direction-Specific Entropy

Entropy flow differs by direction:

**Backward edges** (historical context): "What caused this?"
- Linear decay, dies at 10 hops
- Recent causal history is most valuable
- Old causes fade quickly

**Forward edges** (predictive context): "What might follow?"
- Delayed linear, holds for 5 hops, dies at 20 hops
- Immediate predictions stay strong longer
- Anticipatory context decays more slowly

This asymmetry reflects thermodynamic reality: knowing causes helps explain effects (backward), but predicting effects from causes is inherently more uncertain (forward).

## Maximum Entropy Edge Creation

When creating edges across a D-T-D transition, ECM uses a **maximum entropy** approach:

```
D₁ (m chunks) → T → D₂ (n chunks)
Creates: m × n edges (all-pairs)
```

We cannot reliably determine which specific input chunk caused which specific output chunk without deep semantic analysis. Rather than guess, ECM assumes maximum uncertainty (maximum entropy) and creates all possible causal links. The decay mechanism then naturally prunes weak associations over time.

## Thermodynamic Parallels

| Thermodynamic Concept | ECM Analog |
|-----------------------|------------|
| Entropy increase | Edge weight decay |
| Arrow of time | D-T-D causal direction |
| Heat death | Graph pruning (edges die) |
| Information loss | Causal compression |
| Local vs global time | Hop distance vs wall clock |
| Reversibility | Backward vs forward traversal |

## Practical Implications

The entropic model has concrete benefits:

1. **Project switches don't break memory**: Returning after days shows high relevance if causally connected
2. **Interleaved work is handled correctly**: Multiple topics in one session maintain proper causal ordering
3. **Natural topology management**: Dead edges are pruned without arbitrary thresholds
4. **Predictable memory pressure**: Decay rates control graph growth deterministically

## Related

- [Vector Clocks](./vector-clocks.md) - How causal distance is measured
- [Decay Models](./decay-models.md) - Implementation of entropic decay
- [Why Causal Graphs](./why-causal-graphs.md) - Graph structure motivation
