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

**Decision**: Measure distance in logical D-T-D hops (traversal depth), not elapsed time.

**What was tried**: Exponential wall-clock decay, linear hop decay, delayed linear, multi-linear.

**Why**: Wall-clock decay made all historical edges appear "dead" — returning to a project after a weekend showed no memory. Hop-based decay preserves cross-session continuity because Monday's work and Tuesday's continuation are 1 hop apart regardless of the 24-hour gap.

**Evidence**: [Decay curve experiments](archive/decay-curves.md), [lessons learned §1](experiments/lessons-learned.md)

## Direction-Specific Decay Curves

**Decision**: Backward edges use exponential decay (half-life ~5 hops, effective range ~30), forward edges use simple linear (dies@30 hops).

**What was tried**: 9 models across 30 sessions (5,505 references): linear, delayed-linear, multi-linear (3 variants), exponential (2 variants), power-law (2 variants). Evaluated with MRR, Spearman correlation, and stratified analysis at 5 hop-distance strata.

**Why**: Backward decay must be strictly monotonic (hold periods hurt, dropping MRR from 0.985 to 0.423) and must have a long tail (references exist at 21+ hops at 3% rate — linear dies@10 killed this signal). Exponential matches the empirical reference rate curve: 88% drop at hop 2, then gradual decline. For forward, all 9 models produce identical MRR at every stratum — only monotonicity matters, so simple linear was chosen for clarity.

**Supersedes**: v0.2 decision of linear dies@10 (backward) and delayed-linear 5h/dies@20 (forward). The previous backward curve was too short; the previous forward hold period added complexity for zero benefit.

**Evidence**: [Decay curve experiments](archive/decay-curves.md)

## Edge Types and Weights (Historical, pre-v0.3)

**Decision**: 9 edge types with evidence-based weights. File-path edges weighted highest (1.0), adjacent edges weakest (0.5).

**What was tried**: Adjacent edges as primary signal (failed — "let me commit" followed by "now let's work on X" are adjacent but unrelated).

**Why**: File-path edges are the strongest relevance signal (44.6% of references). Adjacent edges are weak and pollute results when highly weighted.

**Superseded by**: Structural edge types (v0.3) — see below.

**Evidence**: [Edge decay model §reference type distribution](archive/edge-decay-model.md), [lessons learned §4](experiments/lessons-learned.md)

## Structural Edge Types with m×n All-Pairs (v0.3, Early — Superseded)

**Decision**: Replace 9 semantic edge types with 4 purely structural roles. Create m×n all-pairs edges at each D-T-D turn boundary with topic-shift gating.

**What was superseded**: 9 semantic reference types (file-path, code-entity, explicit-backref, error-fragment, tool-output, adjacent, cross-session, brief, debrief) with evidence-based weights. This conflated semantic and causal association.

**Why**: The causal graph should encode only causal structure. Semantic association (what topics are related) is vector search and clustering's job.

**Key design choices**:

- 4 structural roles: within-chain (1.0), cross-session (0.7), brief (0.9), debrief (0.9)
- m×n all-pairs at each consecutive turn boundary (no edges within the same turn)
- Topic-shift gating: time gap > 30min or explicit shift markers → no edges
- Brief/debrief: m×n all-pairs between parent and sub-agent chunks, with 0.9^depth penalty

**Superseded by**: Sequential 1-to-1 edges with chain walking (v0.3, later phases). The m×n topology created O(n²) edges per turn; sum-product traversal contributed only 2% of results. See "Chain Walking Replaces Graph Traversal" below.

**Evidence**: [role-of-entropy.md](approach/role-of-entropy.md), [why-causal-graphs.md §Edge Types](approach/why-causal-graphs.md)

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

## Removal of Vector Clocks (v0.3.0)

**Decision**: Replace vector-clock hop counting with hop-based edge decay (traversal depth).

**What was superseded**: Vector clocks tracked D-T-D cycles per thought stream. Hop distance (sum of per-agent clock differences) determined edge decay. The pruner removed "dead" edges with zero weight.

**Why**: The graph topology already encodes causality by construction. Hop-based edge decay (traversal depth / turn count difference) is simpler and avoids the overhead of maintaining per-session vector clocks, reference clocks, and a pruner. Edge cleanup happens naturally via FK CASCADE when chunks are deleted by TTL or FIFO eviction.

**What was kept**: D-T-D semantics, brief/debrief edge types, causal graph structure, topic-shift gating.

**What was later removed**: Sum-product traversal, direction-specific decay curves, and the graph pruner were all removed in subsequent phases (see "Chain Walking Replaces Graph Traversal" below).

**Evidence**: Phases 1-6 implementation, all 1591 tests passing.

## Chain Walking Replaces Graph Traversal (v0.3.0)

**Decision**: Replace sum-product graph traversal with sequential chain walking along linked-list edges.

**What was superseded**: Sum-product traversal (`src/retrieval/traverser.ts`), direction-specific hop decay (`src/storage/decay.ts`), m×n all-pairs edge topology, and the graph pruner (`src/storage/pruner.ts`). All deleted.

**Why**: Graph traversal contributed only ~2% of retrieval results in collection benchmarks (augmentation ratio 1.1×). The m×n all-pairs topology created O(n²) edges per turn boundary (5×5 chunks = 25 edges per transition), most between unrelated chunks. Sum-product path products converge to zero too rapidly to compete with direct vector/keyword search. The graph's actual value is structural ordering (what came before/after), not semantic ranking.

**What replaced it**: Sequential linked-list edges (each chunk links to the next in its session), walked by `chain-walker.ts`. Chain walking follows edges forward or backward from vector/keyword seeds, scoring each step by direct cosine similarity against the query. This produces ordered episodic narratives rather than ranked disconnected chunks.

**Key design choices**:

- Sequential edges: 1-to-1 (not m×n), preserving session order
- Cosine-similarity scoring per hop (not multiplicative path products)
- `search-assembler.ts` replaces `context-assembler.ts` as the retrieval pipeline
- Chain quality measured by coverage, mean length, score/token, fallback rate

**Evidence**: Collection benchmark (42/100 overall, graph contributing 2%), Phase 1-6 implementation.

## Search Replaces Explain (v0.3.0)

**Decision**: Remove the `explain` MCP tool and add `search` for pure semantic discovery.

**What was superseded**: The `explain` tool attempted to trace causal history via graph traversal. With traversal removed, its implementation was hollow.

**Why**: `explain` depended on graph traversal to "explain the history behind X" by walking causal paths. Without traversal, it was just vector search with different prompting. The new `search` tool is honest about what it does: pure semantic discovery via hybrid BM25 + vector search, with optional chain walking for episodic context.

**Evidence**: MCP tools implementation (`src/mcp/tools.ts`).
