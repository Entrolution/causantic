# Why Vector Clocks?

This document explains ECM's use of vector clocks for temporal ordering.

## The Problem with Wall-Clock Time

Wall-clock time is misleading for memory systems:

```
Monday 9am: Work on auth module
Monday 5pm: Switch to different project
Tuesday 9am: Return to auth module

Wall-clock distance: Monday 9am -> Tuesday 9am = 24 hours
Logical distance: Monday 9am -> Tuesday 9am = 1 "hop" (same train of thought)
```

Using wall-clock time, the Tuesday work appears "old" even though it's a direct continuation.

## D-T-D Semantics

ECM uses D-T-D (Decision-Thought-Do) vector clocks:

```
D = Human input (Decision to do something)
T = Claude's response (Thought/reasoning)
D = Tool execution (Doing the action)
```

Each transition increments a component of the vector clock:

```typescript
{
  ui: 5,      // 5 human inputs so far
  human: 3,   // 3 distinct decisions
  tool: 12    // 12 tool executions
}
```

## Hop Distance

Logical distance is calculated as the difference in vector clock values:

```typescript
function hopDistance(a: VectorClock, b: VectorClock): number {
  // Sum of component differences
  return Math.abs(a.ui - b.ui) + Math.abs(a.human - b.human) + Math.abs(a.tool - b.tool);
}
```

This measures "semantic distance" - how many logical steps separate two chunks.

## Decay Based on Hops

Edge weights decay based on hop distance, not time:

```
Backward (historical):
  weight = 1 - (hops / 10)
  Dies at 10 hops

Forward (predictive):
  weight = 1.0 for first 5 hops
  Then: weight = 1 - ((hops - 5) / 15)
  Dies at 20 hops
```

## Advantages

1. **Project switches don't break continuity**
   - Returning to a project after days still shows high relevance

2. **Interleaved work is handled correctly**
   - Working on multiple features in one session maintains proper ordering

3. **Logical relationship > temporal relationship**
   - "What came next conceptually" matters more than "what happened next chronologically"

## Comparison

| Approach | Monday 9am -> Tuesday 9am |
|----------|---------------------------|
| Wall-clock | 24 hours (seems old) |
| Session-based | 2 sessions (ignores relationship) |
| Vector clock | 1 hop (recognizes continuation) |

## Results

Hop-based decay improves retrieval accuracy by 35% (backward) and 271% (forward) compared to exponential time-based decay.

See [../experiments/decay-curves.md](../experiments/decay-curves.md) for benchmark data.
