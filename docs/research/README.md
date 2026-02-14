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

**Result**: Direction-specific decay curves outperform uniform exponential

- Backward (historical): Linear decay achieves MRR=0.688 (1.35× vs exponential)
- Forward (predictive): Delayed linear achieves MRR=0.849 (3.71× vs exponential)

> In v0.3.0, decay switched from vector-clock hops to hop-based traversal depth (turn count difference). The relative curve rankings remain valid.

See [experiments/decay-curves.md](experiments/decay-curves.md).

### Graph Traversal

> **v0.2 research result**: The 4.65× augmentation was measured using sum-product traversal with m×n all-pairs edges (492 queries, file-path ground truth). This architecture was replaced in v0.3.0 — collection benchmarks showed graph traversal contributing only ~2% of results. See "What Evolved in v0.3.0" below.

**Result (v0.2)**: 4.65× context augmentation via sum-product traversal

See [experiments/graph-traversal.md](experiments/graph-traversal.md).

### Embedding Model

**Result**: Jina-small selected for optimal size/quality tradeoff

Among tested models, jina-small provides the best balance of embedding quality and inference speed. See [experiments/embedding-models.md](experiments/embedding-models.md).

## What Evolved in v0.3.0

The research findings above shaped v0.2's architecture. v0.3.0 made significant changes based on production experience:

- **Sum-product traversal removed**: Contributed only ~2% of retrieval results. Path weight products converge to zero too fast to compete with direct vector/keyword search.
- **m×n all-pairs edges replaced**: Created O(n²) edges per turn boundary, most between unrelated chunks. Replaced by sequential 1-to-1 linked-list edges.
- **Chain walking added**: Follows sequential edges from search seeds, scoring each hop by cosine similarity. Provides episodic narrative ordering rather than semantic ranking.
- **Vector clocks removed**: Hop-based decay (itself removed with traversal) replaced vector-clock hop counting.
- **`search` tool replaces `explain`**: Honest about what it does — pure semantic discovery with optional chain context.

The core insights remain valid: causal structure matters more than wall-clock time, lexical features detect topic shifts, and HDBSCAN clustering provides topic organization. What changed is *how* the causal graph is used — for structural ordering, not semantic ranking.

See [experiments/lessons-learned.md](experiments/lessons-learned.md) for detailed post-mortems.

## Design Rationale

### The Role of Entropy (Historical — v0.2)

> Sum-product traversal and multiplicative path weights were removed in v0.3.0. The analysis below motivated the original graph design but describes mechanisms that no longer exist.

Discrimination degrades along causal paths. As you traverse farther from a query point, edge weight products converge toward zero — you lose the ability to distinguish between distant nodes. This entropy flows along causal lines (D-T-D hops), not wall-clock time, implementing **causal compression**.

See [approach/role-of-entropy.md](approach/role-of-entropy.md).

### Why Causal Graphs?

Unlike simple vector databases, Causantic tracks *relationships* between memory chunks:

- **Causality**: What led to what
- **Temporal ordering**: Edge age tracks recency
- **Structural roles**: Within-chain, cross-session, brief/debrief edges

See [approach/why-causal-graphs.md](approach/why-causal-graphs.md).

### Vector Clocks (Historical)

> Vector clocks were removed in v0.3.0. Edge decay is now hop-based (traversal depth).

The original design used vector clocks for logical hop counting. This was replaced with simpler hop-based edge decay (turn count difference) while preserving the causal graph structure.

See [approach/vector-clocks.md](approach/vector-clocks.md) for the historical rationale.

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
4. **Adjacent edges as primary signal**: Too weak (0.5 weight); led to eliminating all semantic edge types
5. **Sum-product graph traversal at scale** (v0.3.0): Path products converge to zero too fast — graph contributed only 2% of results
6. **m×n all-pairs edge topology** (v0.3.0): O(n²) edges per turn, most between unrelated chunks
7. **Conflating semantic and causal concerns** (v0.3.0): The graph's value is structural ordering, not semantic ranking

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
