# Decay Models

This document explains ECM's approach to edge weight decay and why hop-based decay outperforms time-based decay.

## The Problem

Memory edges become less relevant over time, but how do we model this decay?

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

ECM measures distance in "hops" (logical steps in the causal graph):

```typescript
function hopDecay(edge: Edge, hopsFromAnchor: number): number {
  const { diesAtHops, holdHops } = edge.decayConfig;

  if (hopsFromAnchor <= holdHops) {
    return 1.0;  // Full weight during hold period
  }

  const decayHops = hopsFromAnchor - holdHops;
  const maxDecayHops = diesAtHops - holdHops;

  return Math.max(0, 1 - decayHops / maxDecayHops);
}
```

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
Weight: 0.9 (mostly dead)  Weight: 0.8 (still relevant)
```

### The Vector Clock Connection

ECM's vector clocks capture "happens-before" relationships:

```typescript
interface VectorClock {
  ui: number;     // UI interactions
  human: number;  // Human messages
  file: number;   // File operations
}
```

Hops are measured by vector clock distance, not wall time.

## Direction-Specific Decay

A key insight: backward and forward edges need different decay curves.

### Backward Edges (Historical Context)

"What led to this?" → We want *recent* history, not ancient history.

```
Backward decay: Linear, dies at 10 hops

Weight
1.0 │●
    │ ●
    │  ●
0.5 │   ●
    │    ●
0.0 │     ●────────
    ├─────────────────
    0  5  10  15  Hops
```

**Configuration**:
- Type: linear
- Dies at: 10 hops
- Hold: 0 hops

### Forward Edges (Predictive Context)

"What might come next?" → Recent predictions are most valuable.

```
Forward decay: Delayed linear, 5-hop hold, dies at 20 hops

Weight
1.0 │●●●●●●
    │      ╲
0.5 │       ╲
    │        ╲
0.0 │         ╲────
    ├─────────────────
    0  5  10  15  20  Hops
```

**Configuration**:
- Type: delayed-linear
- Hold: 5 hops (immediate predictions stay strong)
- Dies at: 20 hops

## Decay Curve Types

ECM supports multiple decay curve shapes:

### Linear

```typescript
function linear(hop: number, diesAt: number): number {
  return Math.max(0, 1 - hop / diesAt);
}
```

### Exponential

```typescript
function exponential(hop: number, halfLife: number): number {
  return Math.pow(0.5, hop / halfLife);
}
```

### Delayed Linear

```typescript
function delayedLinear(hop: number, hold: number, diesAt: number): number {
  if (hop <= hold) return 1.0;
  return Math.max(0, 1 - (hop - hold) / (diesAt - hold));
}
```

## Experimental Results

### Backward Edge Decay Sweep

| Config | MRR | Precision@5 |
|--------|-----|-------------|
| Linear, dies@5 | 0.612 | 0.58 |
| **Linear, dies@10** | **0.688** | **0.71** |
| Linear, dies@15 | 0.654 | 0.68 |
| Exponential, half@5 | 0.641 | 0.65 |

### Forward Edge Decay Sweep

| Config | MRR | Precision@5 |
|--------|-----|-------------|
| Linear, dies@10 | 0.723 | 0.75 |
| Linear, dies@20 | 0.801 | 0.83 |
| **Delayed, hold@5, dies@20** | **0.849** | **0.89** |
| Delayed, hold@10, dies@30 | 0.812 | 0.85 |

## Configuration

ECM's decay configuration:

```json
{
  "decay": {
    "backward": {
      "type": "linear",
      "diesAtHops": 10
    },
    "forward": {
      "type": "delayed-linear",
      "holdHops": 5,
      "diesAtHops": 20
    }
  }
}
```

## Key Insights

1. **Hops > Time**: Logical distance matters more than physical time
2. **Direction matters**: Backward and forward edges serve different purposes
3. **Hold periods help**: Immediate context should stay strong
4. **Linear is fine**: Simple curves work as well as complex ones

## Related

- [Vector Clocks](./vector-clocks.md) - How hops are measured
- [Decay Curves Experiments](../experiments/decay-curves.md) - Full experimental data
