# Why Causal Graphs?

This document explains why Causantic uses causal graphs rather than simpler approaches.

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

Edge decay tracks logical distance via hop count (traversal depth):

```
Chunk A ──1 hop──▶ Chunk B    (weight: 0.87)
Chunk A ──5 hops──▶ Chunk F   (weight: 0.50)
```

This works even if sessions were days apart — logical hops, not wall-clock time.

### Context Assembly

Graph traversal finds related context that vector search misses:

```
1. Vector search finds: authentication fix (score: 0.9)
2. Graph traversal adds:
   - The error that triggered it (1 hop back)
   - The test that validated it (1 hop forward)
   - The config change involved (causal edge)
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

Causantic uses purely structural edge types — semantic association is handled by vector search and clustering. Edges encode causal structure only:

| Type | Weight | Description |
|------|--------|-------------|
| `within-chain` | 1.0 | D-T-D causal edge within one thinking entity. Created as m×n all-pairs at each consecutive turn boundary, with topic-shift gating. |
| `brief` | 0.9 | Parent agent spawning a sub-agent. m×n all-pairs between parent turn chunks and sub-agent first-turn chunks. 0.9^depth penalty for nested agents. |
| `debrief` | 0.9 | Sub-agent returning results to parent. m×n all-pairs between sub-agent final-turn chunks and parent turn chunks. 0.9^depth penalty. |
| `cross-session` | 0.7 | Session continuation. m×n between previous session's final-turn chunks and new session's first-turn chunks. |

### Design evolution: from max entropy to sequential edges

| Aspect | v0.2 (m×n all-pairs) | v0.3 (sequential) |
|--------|----------------------|-------------------|
| Edge topology | m×n at each turn boundary | 1-to-1 linked list |
| Edges per transition | O(m×n), e.g. 5×5 = 25 | O(max(m,n)), e.g. 5 |
| Retrieval mechanism | Sum-product traversal with decay | Chain walking with cosine scoring |
| Scoring | Multiplicative path products | Independent cosine similarity per hop |
| Edge types | 4 structural (within-chain, cross-session, brief, debrief) | Sequential + cross-session + brief/debrief |

> **Historical note**: v0.2 used m×n all-pairs edges with sum-product traversal. This was theoretically motivated by maximum entropy (don't impose false structure), but in practice the graph contributed only ~2% of retrieval results. v0.3 uses sequential 1-to-1 edges — simpler, fewer edges, and the graph's value is structural ordering (episodic narratives) rather than semantic ranking.
>
> Earlier versions (pre-v0.3) also used 9 semantic reference types (file-path, code-entity, explicit-backref, etc.) with evidence-based weights. This conflated semantic and causal association. Both redesigns (v0.2 structural types, v0.3 sequential edges) moved toward separating concerns.

## Comparison

| Approach | Finds Similar | Finds Related | Temporal Aware |
|----------|--------------|---------------|----------------|
| Vector DB | Yes | No | No |
| Graph DB | No | Yes | Partial |
| Causantic | Yes | Yes | Yes |

## Results

> **Caveat**: The 221% (3.21×) figure below was measured in v0.2 using sum-product traversal with m×n all-pairs edges and file-path ground truth. v0.3 collection benchmarks showed the graph contributing ~2% of results with that architecture. The current v0.3 chain-walking architecture provides value through episodic narrative ordering rather than augmentation ratio. See [../experiments/graph-traversal.md](../experiments/graph-traversal.md) for both v0.2 and current results.

Graph-augmented retrieval in v0.2 provided 221% more relevant context than vector search alone (single-project baseline, 10 queries, file-path ground truth).
