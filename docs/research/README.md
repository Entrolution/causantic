# Research Documentation

This section documents the research and experimentation behind Causantic's design decisions.

## Overview

Causantic was developed through systematic experimentation on real Claude Code session data:

- **75 sessions** analyzed for topic continuity and edge decay
- **6,000+ chunks** processed for clustering validation
- **9,361 references** evaluated for retrieval accuracy

## Key Findings

### Topic Continuity Detection

**Result**: 0.998 AUC with lexical features

The D-T-D (Data-Transformation-Data) boundary detection achieves near-perfect accuracy for identifying session transitions. See [experiments/topic-continuity.md](experiments/topic-continuity.md).

### Clustering Threshold

**Result**: F1=0.940 at angular threshold 0.09

HDBSCAN clustering with angular distance achieves 100% precision and 88.7% recall. See [experiments/cluster-threshold.md](experiments/cluster-threshold.md).

### Temporal Decay

**Result**: Direction-specific hop decay outperforms time-based decay

- Backward (historical): Linear, dies at 10 hops (MRR=0.688, 1.35× vs exponential)
- Forward (predictive): Delayed linear, 5-hop hold, dies at 20 (MRR=0.849, 3.71× vs exponential)

See [experiments/decay-curves.md](experiments/decay-curves.md).

### Graph Traversal

**Result**: 221% context augmentation with lazy pruning

Graph-based retrieval more than doubles the relevant context found compared to vector search alone. See [experiments/graph-traversal.md](experiments/graph-traversal.md).

### Embedding Model

**Result**: Jina-small selected for optimal size/quality tradeoff

Among tested models, jina-small provides the best balance of embedding quality and inference speed. See [experiments/embedding-models.md](experiments/embedding-models.md).

## Design Rationale

### Why "Entropic"?

The name reflects how discrimination degrades along causal paths. As you traverse farther from a query point, edge weight products converge toward zero — you lose the ability to distinguish between distant nodes. This entropy flows along causal lines (D-T-D hops), not wall-clock time, implementing **causal compression**.

See [approach/why-entropic.md](approach/why-entropic.md).

### Why Causal Graphs?

Unlike simple vector databases, Causantic tracks *relationships* between memory chunks:

- **Causality**: What led to what
- **Temporal ordering**: Logical sequence via vector clocks
- **Reference tracking**: File paths, topics, and adjacency

See [approach/why-causal-graphs.md](approach/why-causal-graphs.md).

### Why Vector Clocks?

Wall-clock time is misleading for memory:

- Sessions may be days apart but semantically adjacent
- Work may be interleaved across projects
- Logical "hops" matter more than minutes elapsed

See [approach/vector-clocks.md](approach/vector-clocks.md).

### Why Dual Integration?

Causantic integrates via both hooks and MCP for different needs:

- **Hooks**: Automatic, background capture
- **MCP**: On-demand, interactive queries

See [approach/dual-integration.md](approach/dual-integration.md).

### Landscape Analysis

How Causantic compares to existing memory systems (Mem0, Cognee, Letta, Zep, etc.).

See [approach/landscape-analysis.md](approach/landscape-analysis.md).

## Design Decision Log

A chronological narrative of every major decision — the "story of the project" in one place.

See [decisions.md](decisions.md).

## What Didn't Work

Documenting failures is as important as successes:

1. **Wall-clock time decay**: All historical edges appeared "dead" regardless of relevance
2. **Single decay curve**: Forward and backward edges need different treatment
3. **hdbscan-ts at scale**: O(n²k) bug made it impractical (fixed with native implementation)
4. **Adjacent edges as primary signal**: Too weak (0.5 weight); file-path edges (1.0) work better

See [experiments/lessons-learned.md](experiments/lessons-learned.md).

## Future Work

Open questions and ideas for future research:

- Token usage analytics and compression ratios
- Incremental clustering algorithms
- Multi-modal memory (images, diagrams)
- Cross-user memory sharing

See [future-work.md](future-work.md).

## Research Archive

The original working documents from the research phase are preserved in the [archive](archive/) directory. These contain the raw analysis and experiment data that shaped the final implementation.

## Data and Reproducibility

Experiment data is available in `benchmark-results/` for reproducibility. Key datasets:

- Full corpus: 251 sessions, 3.5 GB
- Embedding benchmark: 294 chunks, 12 sessions
- Topic continuity: 2,817 transitions, 75 sessions
- Edge decay: 9,361 references, 75 sessions
