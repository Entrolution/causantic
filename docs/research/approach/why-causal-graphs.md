# Why Causal Graphs?

This document explains why ECM uses causal graphs rather than simpler approaches.

## The Problem with Vector-Only Search

Vector databases are great for semantic similarity, but they miss relationships:

```
Query: "How did we fix the authentication bug?"

Vector search returns:
- Chunk about authentication
- Chunk about a different bug
- Chunk about fixes in general

Missing context:
- The debugging session that led to the fix
- The related error message that was encountered
- The follow-up testing that validated the fix
```

## What Causal Graphs Add

### Relationship Tracking

Edges capture how chunks relate:

```
[Error Message] --causes--> [Debugging] --leads-to--> [Fix]
                                 |
                                 v
                           [Related File]
```

### Temporal Flow

Vector clocks track logical ordering:

```
Chunk A (clock: {ui: 5})  happened before  Chunk B (clock: {ui: 7})
```

This works even if sessions were days apart.

### Context Assembly

Graph traversal finds related context that vector search misses:

```
1. Vector search finds: authentication fix (score: 0.9)
2. Graph traversal adds:
   - The error that triggered it (1 hop back)
   - The test that validated it (1 hop forward)
   - The config file involved (file-path edge)
```

## Why Chunks, Not Clusters?

An alternative design would use **clusters** (topic groupings) as nodes instead of individual chunks. This was considered but rejected.

### The Problem with Cluster Nodes

If clusters were nodes in the causal graph:

1. **Semantic variance compounds**: Each cluster is an average of its members. As you traverse paths, the "meaning" becomes increasingly blurred.

2. **Non-uniform entropy**: Dense clusters (many similar chunks) behave differently than sparse clusters (diverse chunks). This creates an additional entropic force that varies unpredictably across the graph.

3. **Tuning becomes impossible**: Decay curves would need to account for cluster heterogeneity. A 3-hop path through tight clusters differs fundamentally from a 3-hop path through loose clusters.

### Chunks Keep Signal Clean

With chunks as nodes:

- **Precise semantics**: Each node has fixed, unambiguous meaning
- **Uniform decay**: Edge weights decay predictably based on hop distance alone
- **No compounding variance**: The semantic content at each node doesn't blur

### Best of Both Worlds

The current design separates concerns:

| Concern | Mechanism | Unit |
|---------|-----------|------|
| Causal traversal | Edge weights + decay | Chunks (precise) |
| Topic discovery | HDBSCAN clustering | Clusters (semantic grouping) |
| Entry point search | Vector similarity | Embeddings (similarity) |

Clusters serve as a **lens for browsing and labeling** rather than a **unit of causality**. This keeps the entropic decay well-behaved while still providing topic organization.

## Edge Types

ECM tracks multiple relationship types, organized by evidence strength:

### Strong Evidence (0.9-1.0)

| Type | Weight | Description |
|------|--------|-------------|
| `file-path` | 1.0 | Explicit file path reference shared between chunks |
| `explicit-backref` | 0.9 | Explicit references like "the error", "that function" |
| `error-fragment` | 0.9 | Discussing a specific error message |
| `brief` | 0.9 | Parent agent spawning a sub-agent |
| `debrief` | 0.9 | Sub-agent returning results to parent |

### Medium Evidence (0.7-0.8)

| Type | Weight | Description |
|------|--------|-------------|
| `code-entity` | 0.8 | Shared function, class, or variable name |
| `tool-output` | 0.8 | Referencing tool execution results |
| `cross-session` | 0.7 | Continuation from a previous session |

### Weak Evidence (0.5)

| Type | Weight | Description |
|------|--------|-------------|
| `adjacent` | 0.5 | Consecutive chunks with no stronger link detected |

## Comparison

| Approach | Finds Similar | Finds Related | Temporal Aware |
|----------|--------------|---------------|----------------|
| Vector DB | Yes | No | No |
| Graph DB | No | Yes | Partial |
| ECM | Yes | Yes | Yes |

## Results

Graph-augmented retrieval provides 221% more relevant context than vector search alone.

See [../experiments/graph-traversal.md](../experiments/graph-traversal.md) for benchmark data.
