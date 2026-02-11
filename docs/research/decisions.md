# Design Decision Log

A chronological narrative of every major design decision in Causantic's development, from research through implementation. This is the "story of the project" — start here if you want to understand why things are the way they are.

## Storage Backend

**Decision**: SQLite for structured data (chunks, edges, clusters) + LanceDB for vector embeddings.

**What was considered**: SQLite-only, LanceDB-only, file-based JSON, SQLite + JSON blobs.

**Why**: SQLite provides ACID transactions, native full-text search (FTS5), and zero configuration. LanceDB provides native approximate nearest neighbor queries for embeddings. The hybrid approach keeps each store doing what it does best.

**Evidence**: [Pre-implementation plan §1.1](archive/pre-implementation-plan.md)

## Embedding Model

**Decision**: jina-small (`Xenova/jina-embeddings-v2-small-en`, 512 dims, 8K context).

**What was tried**: jina-small, jina-code, bge-small, nomic-v1.5 — benchmarked across two corpus sizes (66 → 294 chunks).

**Why**: Highest ROC AUC in both runs (0.794 → 0.715), highest silhouette (0.432 → 0.384), 8K context avoids truncation artifacts that plagued bge-small. 512ms/chunk is practical for background processing.

**Evidence**: [Embedding model experiments](experiments/embedding-models.md), [full benchmark results](archive/embedding-benchmark-results.md)

## Thinking Block Removal

**Decision**: Exclude assistant thinking blocks before embedding.

**What was tried**: Full content vs thinking-excluded ablation study.

**Why**: +0.063 ROC AUC improvement — the largest single preprocessing gain. Thinking blocks contain diffuse reasoning (planning, self-correction) that dilutes the embedding signal.

**Evidence**: [Embedding benchmark follow-up experiment 4](archive/embedding-benchmark-results.md#experiment-4-thinking-block-ablation)

## Clustering Approach

**Decision**: HDBSCAN with angular distance, `minClusterSize=4`, threshold 0.09.

**What was tried**: Various `minClusterSize` values (2-10), greedy assignment vs threshold-based.

**Why**: `minClusterSize=4` produces best silhouette (0.438 vs 0.384 at 3). Threshold-based assignment prevents cluster pollution from outliers. Angular distance is a proper metric that satisfies triangle inequality.

**Evidence**: [Cluster threshold experiments](experiments/cluster-threshold.md), [embedding benchmark experiment 2](archive/embedding-benchmark-results.md#experiment-2-hdbscan-minclustersize-sweep)

## Native HDBSCAN Implementation

**Decision**: Rewrite HDBSCAN in pure TypeScript instead of using hdbscan-ts.

**What was tried**: hdbscan-ts npm package — took 65+ minutes for 6,000 points due to O(n²k) `Array.includes()` bug.

**Why**: Native implementation with `Set.has()`, quickselect, and union-find achieves 30 seconds — 130x speedup. Eliminates Python bridge dependency.

**Evidence**: [HDBSCAN performance](approach/hdbscan-performance.md), [lessons learned](experiments/lessons-learned.md)

## Decay Model: Hop-Based, Not Wall-Clock

**Decision**: Measure distance in logical D-T-D hops via vector clocks, not elapsed time.

**What was tried**: Exponential wall-clock decay, linear hop decay, delayed linear, multi-linear.

**Why**: Wall-clock decay made all historical edges appear "dead" — returning to a project after a weekend showed no memory. Hop-based decay preserves cross-session continuity because Monday's work and Tuesday's continuation are 1 hop apart regardless of the 24-hour gap.

**Evidence**: [Decay curve experiments](experiments/decay-curves.md), [lessons learned §1](experiments/lessons-learned.md)

## Direction-Specific Decay Curves

**Decision**: Backward edges use linear decay (dies@10 hops), forward edges use delayed linear (5-hop hold, dies@20 hops).

**What was tried**: Single decay curve for both directions, various hold periods and death horizons.

**Why**: Backward and forward edges have different semantics. Backward ("what led to this?") fades quickly — 10 hops captures the relevant history. Forward ("what follows this?") persists longer — consequences are immediate (5-hop hold) but have extended effects (20-hop tail). Delayed linear beats exponential by 3.71x MRR on forward queries.

**Evidence**: [Decay curve experiments](experiments/decay-curves.md), [edge decay model §directional analysis](archive/edge-decay-model.md)

## Edge Types and Weights

**Decision**: 9 edge types with evidence-based weights. File-path edges weighted highest (1.0), adjacent edges weakest (0.5).

**What was tried**: Adjacent edges as primary signal (failed — "let me commit" followed by "now let's work on X" are adjacent but unrelated).

**Why**: File-path edges are the strongest relevance signal (44.6% of references). Adjacent edges are weak and pollute results when highly weighted.

**Evidence**: [Edge decay model §reference type distribution](archive/edge-decay-model.md), [lessons learned §4](experiments/lessons-learned.md)

## Topic Continuity Detection

**Decision**: Lexical features only (time gap + shift/continuation markers + file overlap).

**What was tried**: Embedding-only, lexical-only, hybrid (embedding + lexical).

**Why**: Lexical-only achieves 0.998 AUC — near perfect. Embedding-only is barely above random (~0.55 AUC). Adding embeddings to lexical features doesn't improve and adds latency.

**Evidence**: [Topic continuity experiments](experiments/topic-continuity.md), [full results](archive/topic-continuity-results.md)

## Integration Mechanism: Hooks + MCP

**Decision**: Both hooks (passive capture) and MCP server (active retrieval).

**What was considered**: Hooks only, MCP only, both.

**Why**: Hooks handle automatic background capture (session-start context injection, pre-compact saves). MCP tools handle on-demand interactive queries (recall, explain, predict). Different use cases need different integration points.

**Evidence**: [Pre-implementation plan §1.3](archive/pre-implementation-plan.md), [dual integration rationale](approach/dual-integration.md)

## Hybrid BM25 + Vector Search

**Decision**: Run keyword (FTS5/BM25) and vector search in parallel, fuse via Reciprocal Rank Fusion (RRF, k=60).

**What was considered**: Vector-only, keyword-only, hybrid with various fusion strategies.

**Why**: Vector search finds semantically similar content. BM25 finds exact lexical matches — function names, error codes, CLI flags. Neither alone catches everything. RRF fusion is parameter-light and robust. Graceful fallback: keyword search degrades to vector-only if FTS5 is unavailable.

**Evidence**: Schema v5 implementation, [CHANGELOG](../../CHANGELOG.md)

## Project-Filtered Retrieval

**Decision**: Federated approach — all projects in one store, filtered at query time via `projectFilter`.

**What was considered**: Isolated databases per project, hybrid (local chunks + global clusters), federated.

**Why**: Federated allows cross-project graph traversal (edges followed freely) while still filtering retrieval results by project. Single store simplifies backup, maintenance, and administration.

**Evidence**: `session_slug` derived from `basename(info.cwd)` with collision detection for same-basename projects.

## Session Reconstruction

**Decision**: Pure chronological SQLite queries, bypassing the vector/keyword/RRF pipeline entirely.

**Why**: "What did I work on yesterday?" is a time-range query, not a semantic search. Composite index on `(session_slug, start_time)` makes these queries fast. Token budgeting truncates results to fit MCP response limits.

**Evidence**: Schema v6 migration, `reconstructSession()` implementation.
