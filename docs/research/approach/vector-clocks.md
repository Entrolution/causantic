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

ECM uses D-T-D (Data-Transformation-Data) vector clocks. D-T-D is an abstract representation of any processing step as `f(input) → output`:

```
D = Data (input)
T = Transformation (any processing: Claude reasoning, human thinking, tool execution)
D = Data (output)
```

This abstraction is conducive to graph-based reasoning without getting bogged down in compositional semantics, input/output types, or arities. Any transformation that takes data and produces data is a D-T-D cycle.

Each thought stream (main agent, human, or sub-agent) maintains its own clock entry. The vector clock maps stream IDs to their D-T-D cycle counts:

```typescript
interface VectorClock {
  [agentId: string]: number;  // One entry per thought stream
}

// Example with parallel sub-agents:
{
  "ui": 5,              // Main UI agent: 5 D-T-D cycles
  "human": 3,           // Human message count
  "agent-abc123": 2,    // Sub-agent for file exploration
  "agent-def456": 4     // Sub-agent for code refactoring
}
```

When sub-agents spawn, they inherit the parent's clock. When they complete (debrief), their clock merges back via element-wise max.

## Sub-Agent Edge Semantics

Sub-agent spawn and return create special edge types to maintain causal continuity across parallel thought streams:

### Brief Edges (Spawn)

When a parent agent spawns a sub-agent, **brief edges** connect the parent's current chunk to the sub-agent's first chunk:

```
Parent Chunk (spawns sub-agent)
    │
    ├── backward edge ←── Sub-Agent First Chunk
    │                         (sub-agent can recall parent context)
    │
    └── forward edge ──→ Sub-Agent First Chunk
                          (parent predicts sub-agent work)
```

Brief edges have weight **0.9** (strong evidence), with a depth penalty of `0.9^depth` for nested sub-agents.

### Debrief Edges (Return)

When a sub-agent completes and returns to the parent, **debrief edges** connect the sub-agent's final chunk(s) to the parent's receiving chunk:

```
Sub-Agent Final Chunk
    │
    ├── backward edge ←── Parent Receiving Chunk
    │                         (parent recalls sub-agent findings)
    │
    └── forward edge ──→ Parent Receiving Chunk
                          (sub-agent work predicts continuation)
```

Debrief edges also have weight **0.9** with the same depth penalty.

### Why This Matters

Without brief/debrief edges, sub-agent work would be disconnected from the main thought stream. These edges ensure:

1. **Context flows into sub-agents** - Sub-agents can retrieve what the parent was working on
2. **Results flow back** - Parent can retrieve what sub-agents discovered
3. **Decay works correctly** - Hop distance accounts for sub-agent D-T-D cycles

## Hop Distance

Logical distance is the sum of per-agent differences between an edge's clock and the current reference clock. **Only entries present in both clocks contribute to the sum** - agents that didn't exist at edge creation or have since terminated contribute zero:

```typescript
function hopCount(edgeClock: VectorClock, refClock: VectorClock): number {
  let hops = 0;
  for (const agentId of Object.keys(edgeClock)) {
    // Only agents in edgeClock are considered; if also in refClock, count the difference
    hops += Math.max(0, (refClock[agentId] ?? 0) - edgeClock[agentId]);
  }
  return hops;
}
```

This measures "semantic distance" - how many D-T-D cycles have occurred in the thought streams that were **active when the edge was created and still exist now**.

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
