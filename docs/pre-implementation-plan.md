# Pre-Implementation Plan: D-T-D Memory System

> Comprehensive checklist of questions, experiments, and decisions needed before implementation.

**Status**: Planning phase
**Last updated**: 2026-02-06

---

## Executive Summary

The research phase has validated three critical components:
- **Topic continuity detection**: 0.998 AUC with lexical features (30-min time gap threshold)
- **Embedding model selection**: jina-small (0.715 ROC AUC, 0.384 silhouette)
- **Temporal decay modeling**: Delayed Linear with 30-min hold period (+45% MRR over exponential)

Before implementation, we need to address **~25 open questions** grouped into 6 categories. This document prioritizes them into:
- **P0**: Must resolve before any implementation (blockers)
- **P1**: Must resolve before MVP (affects core architecture)
- **P2**: Can defer to iteration (optimize later)

---

## 1. Architecture Decisions (P0 - Blockers)

These decisions affect the fundamental shape of the implementation.

### 1.1 Graph Storage Backend
**Question**: Where to persist the D-T-D graph?

| Option | Pros | Cons |
|--------|------|------|
| SQLite | Simple, embedded, portable | Schema migrations, no native graph queries |
| SQLite + JSON blobs | Flexible schema | Harder to query |
| LanceDB | Vector-native, embedded | Less mature |
| File-based JSON | Simplest, human-readable | No concurrency, slow for large graphs |

**Recommendation**: Start with SQLite + dedicated tables for nodes, edges, clusters. Migrate later if needed.

**Action**: Design schema before implementing.

### 1.2 Embedding Storage
**Question**: Store embeddings in graph DB or separate vector store?

**Options**:
1. **Inline in SQLite**: Simple but bloats DB, no ANN queries
2. **Separate LanceDB**: Native ANN, but two stores to sync
3. **Hybrid**: Cluster centroids in SQLite, chunk embeddings in LanceDB

**Recommendation**: Hybrid approach — cluster metadata in SQLite, chunk embeddings in LanceDB for similarity queries.

**Action**: Prototype both approaches, measure query latency.

### 1.3 MCP Server vs Hooks
**Question**: Primary integration mechanism?

| Approach | Use Case |
|----------|----------|
| **Hooks** | Capture session data (PreCompact), inject context (SessionStart) |
| **MCP Server** | On-demand recall, explain, predict tools for Claude |

**Recommendation**: Both — hooks for passive capture, MCP for active retrieval.

**Action**: Implement hooks first (simpler), add MCP tools incrementally.

### 1.4 Cluster Identity
**Question**: What defines a cluster's identity over time?

When clusters split, merge, or drift:
- Does the cluster keep its ID?
- Do edges to that cluster stay valid?
- How to handle cluster "death"?

**Recommendation**: Clusters have immutable UUIDs. Splits create new clusters; edges to old cluster remain but decay naturally. Merges redirect edges.

**Action**: Document cluster lifecycle formally before implementing.

---

## 2. Threshold & Parameter Questions (P1 - MVP)

These need empirical answers but don't block architecture.

### 2.1 Cluster Assignment Threshold
**Question**: What angular distance threshold assigns a chunk to a cluster?

**Current knowledge**:
- Embedding benchmark used HDBSCAN (no explicit threshold)
- jina-small shows ~0.384 silhouette — moderate separation

**Experiment needed**:
- Compute pairwise angular distances within same-cluster vs cross-cluster
- Find threshold that balances precision/recall
- Test: 0.3, 0.4, 0.5, 0.6 radians

**Action**: Run cluster assignment threshold sweep experiment.

### 2.2 Path Depth Cutoff
**Question**: How deep to traverse causal graph for context retrieval?

**Design assumption**: maxDepth=5

**Experiment needed**:
- Measure reference distance distribution (how many hops between related turns?)
- Edge decay reference data suggests most references are <5 turns

**Action**: Analyze existing reference data for hop distribution.

### 2.3 Signal Threshold
**Question**: What minimum edge weight is "negligible"?

**Options**: 0.1, 0.01, 0.001

**Trade-off**:
- Too high: Prune too aggressively, lose long-range connections
- Too low: Keep noise, bloat traversal

**Action**: Measure edge weight distribution from decay experiments, pick 10th percentile.

### 2.4 Decay Tier Configuration
**Question**: Optimal tier weights and timescales for production?

**Current recommendation** (from experiments):
```
Retrieval: Delayed Linear, 30-min hold, 4-hour decay
Prediction: Exponential, 10-min half-life
```

**Remaining questions**:
- Multi-linear slow vs delayed linear for retrieval?
- Optimal hold period (30 min validated, test 15/45/60)?

**Action**: Run parameter sweep on hold period (15/30/45/60 min).

### 2.5 Initial Edge Weight by Type
**Question**: Should edge weights vary by reference type?

**Reference type distribution** (from experiments):
| Type | % | Suggested Weight |
|------|---|------------------|
| file-path | 44.6% | 1.0 (strong signal) |
| code-entity | 22.6% | 0.8 |
| explicit-backref | 6.4% | 0.9 |
| error-fragment | 2.2% | 0.9 |
| adjacent (weak) | 24.2% | 0.5 |

**Action**: Implement type-weighted edges, measure MRR improvement.

---

## 3. Cluster Representation Questions (P1 - MVP)

How clusters are described and retrieved affects retrieval quality.

### 3.1 Refresh Frequency
**Question**: How often to regenerate cluster descriptions via LLM?

**Options**:
- Per N sessions
- On significant membership change (>20% new chunks)
- On-demand when retrieved

**Recommendation**: Lazy refresh — only when cluster is accessed and stale flag is set.

**Action**: Implement stale detection (membership hash), measure LLM calls.

### 3.2 Exemplar Count
**Question**: How many exemplars per cluster?

**Trade-off**:
- Few (3-5): Cheaper embedding, but may miss diversity
- Many (10-20): Better representation, but slower

**Recommendation**: Start with 5, increase if retrieval quality suffers.

**Action**: Test retrieval quality at 3/5/10 exemplars.

### 3.3 Retrieval Mode Selection
**Question**: Return summary, exemplars, or both?

**Options**:
1. **Summary only**: Compact, good for priming
2. **Exemplars only**: Concrete, good for detailed recall
3. **Both**: Comprehensive but verbose

**Recommendation**: Summary for SessionStart priming, exemplars for MCP tool recall.

**Action**: Implement both modes, let retrieval context decide.

### 3.4 Semantic Drift Detection
**Question**: How to know when a cluster's LLM description no longer matches its exemplars?

**Approach**:
1. Embed the LLM-generated summary
2. Compare to cluster centroid
3. If distance > threshold, mark stale

**Action**: Implement and calibrate threshold.

---

## 4. Integration & Timing Questions (P1 - MVP)

How the system integrates with Claude Code.

### 4.1 PreCompact Hook Frequency
**Question**: How often does PreCompact fire?

**Need to verify**: Does it fire once at end of session, or periodically?

**Action**: Test with actual Claude Code sessions, log hook invocations.

### 4.2 CLAUDE.md Size Budget
**Question**: How many tokens of auto-generated memory content?

**Constraints**:
- CLAUDE.md is always loaded
- Too large = context waste
- Too small = useless

**Recommendation**: 500-1000 tokens for memory section.

**Action**: Prototype and measure impact on session quality.

### 4.3 SessionStart Priming Content
**Question**: What to inject at session start?

**Options**:
1. Top N recently active clusters (by tick count)
2. Clusters related to current project
3. Cross-project relevant clusters

**Recommendation**: Project-specific clusters + top 3 cross-project by recency.

**Action**: Implement and test retrieval relevance.

### 4.4 MCP Tool Latency Budget
**Question**: What's acceptable latency for recall/explain/predict?

**Target**: <500ms for good UX

**Components**:
- Embedding query: ~50ms (jina-small)
- Graph traversal: ~10ms (with indices)
- LLM description: ~500ms (if not cached)

**Action**: Benchmark end-to-end latency, optimize hot paths.

### 4.5 PostToolUse Selectivity
**Question**: Which tool uses warrant memory capture?

**High value**: File reads, writes, edits (code context)
**Low value**: ls, git status (ephemeral)

**Recommendation**: Capture Read, Write, Edit, Bash (file-modifying commands only).

**Action**: Define tool allowlist, implement filtering.

---

## 5. Additional Experiments Needed (P1)

### 5.1 Cluster Assignment Threshold Sweep
**Purpose**: Find optimal angular distance for assigning chunks to clusters.

**Method**:
1. Take embedding benchmark corpus (294 chunks)
2. Run HDBSCAN to get cluster assignments
3. Compute angular distance from each chunk to assigned cluster centroid
4. Sweep threshold from 0.2 to 0.7
5. Measure precision/recall of "same cluster" prediction

**Output**: Recommended threshold with confidence interval.

### 5.2 Edge Weight by Reference Type
**Purpose**: Test if type-weighted edges improve retrieval.

**Method**:
1. Re-run edge decay experiment with type-weighted initial weights
2. Compare MRR to uniform weights
3. Stratify by context distance

**Output**: Optimal weight mapping or confirmation that uniform is fine.

### 5.3 Non-Coding Session Validation
**Purpose**: Verify models work for non-coding conversations.

**Gap**: Current experiments heavily weight coding sessions (Ultan, cdx-core, etc.)

**Method**:
1. Run topic continuity on pde-book (10 sessions, math writing)
2. Run edge decay on Personal-advice
3. Compare metrics to coding baseline

**Output**: Confirmation or adjusted parameters for non-coding.

### 5.4 Cross-Session Memory Relevance
**Purpose**: Test if memories from session N are useful in session N+1.

**Method**:
1. Take multi-session project (apolitical-assistant: 86 sessions)
2. For each session N, retrieve context from sessions <N
3. Measure if retrieved context matches actual references in session N

**Output**: Baseline for cross-session retrieval quality.

### 5.5 Hold Period Parameter Sweep
**Purpose**: Optimize hold period for retrieval decay.

**Method**:
1. Sweep hold periods: 15, 30, 45, 60 minutes
2. Run edge decay experiment for each
3. Focus on long-range MRR (>3 turns)

**Output**: Optimal hold period (expect 30 min to win, but verify).

---

## 6. Deferred Questions (P2 - Post-MVP)

These can be addressed after initial implementation.

### 6.1 Cross-Project Memory
**Question**: Share associations across projects or isolate?

**Defer because**: Start isolated, add cross-project later if valuable.

### 6.2 Cluster Hierarchy Depth
**Question**: How many levels of abstraction?

**Defer because**: Start flat, add hierarchy if clusters get too numerous.

### 6.3 Long Inactivity Handling
**Question**: Should wall time factor in after months of inactivity?

**Defer because**: Unlikely to matter in initial deployment.

### 6.4 Visualization UI
**Question**: Should there be a UI to explore the memory graph?

**Defer because**: Developer tooling, not core functionality.

### 6.5 Manual Curation
**Question**: Allow users to pin/delete/edit memories?

**Defer because**: Power user feature, not MVP.

### 6.6 Export Format
**Question**: What format for memory graph portability?

**Defer because**: Solve when needed.

### 6.7 Traversal Transparency
**Question**: Show users "why" certain context was retrieved?

**Defer because**: Nice-to-have for debugging, not core.

### 6.8 Reinforcement on Access
**Question**: Should accessing a memory strengthen it?

**Defer because**: Adds complexity, current decay model sufficient.

---

## 7. Resolved Questions (Reference)

These have been answered through experiments.

| Question | Answer | Evidence |
|----------|--------|----------|
| Topic continuity detection | Lexical features (0.998 AUC), 30-min time gap threshold | Topic continuity experiment |
| Embedding model selection | jina-small (0.715 AUC, 0.384 silhouette) | Embedding benchmark |
| Decay curve type | Delayed Linear for retrieval, Exponential for prediction | Edge decay experiments |
| Directional asymmetry | Yes — +0.64 MRR delta for delayed linear | Forward prediction experiment |
| Thinking block handling | Remove before embedding (+0.063 AUC) | Ablation study |
| Chunk strategy | Turn-based, code-block aware | Parser implementation |
| Cold start problem | Not real — full context until compaction | Design analysis |
| Parallelism detection | Via parentToolUseID + timestamps | Session data inspection |

---

## 8. Implementation Order

Based on dependencies and risk, implement in this order:

### Phase 1: Core Infrastructure
1. **Schema design** — SQLite tables for nodes, edges, clusters
2. **Embedding store** — LanceDB integration for chunk vectors
3. **Session ingestion** — Parse sessions, create chunks, embed, store

### Phase 2: Graph Construction
4. **Topic continuity** — Apply lexical classifier to detect turn boundaries
5. **Edge creation** — All-pairs edges between adjacent D chunks
6. **Decay application** — Query-time weight calculation

### Phase 3: Cluster Detection
7. **HDBSCAN integration** — Periodic clustering of chunks
8. **Cluster metadata** — Store centroids, exemplars, descriptions
9. **Assignment threshold** — Implement threshold-based assignment

### Phase 4: Retrieval
10. **Basic recall** — Query by embedding similarity
11. **Graph traversal** — Follow edges with decay weights
12. **Context assembly** — Build retrieval response

### Phase 5: Integration
13. **Hooks** — PreCompact capture, SessionStart injection
14. **MCP tools** — recall, explain, predict
15. **CLAUDE.md generation** — Auto-generate memory section

### Phase 6: Optimization
16. **LLM refresh** — Semantic cluster descriptions
17. **Performance tuning** — Index optimization, caching
18. **Parameter tuning** — Based on production metrics

---

## 9. Recommended Next Steps

Before starting implementation:

1. **Run cluster assignment threshold sweep** (1-2 hours)
2. **Run hold period parameter sweep** (1-2 hours)
3. **Validate on non-coding sessions** (1 hour)
4. **Design SQLite schema** (30 min)
5. **Define MCP tool interfaces** (30 min)

After these, we'll have high confidence in all P0/P1 decisions and can start Phase 1 implementation.

---

## Appendix: Data Available

| Dataset | Size | Sessions | Use |
|---------|------|----------|-----|
| Full corpus | 3.5 GB | 251 | Production |
| Embedding benchmark | 294 chunks | 12 | Cluster experiments |
| Topic continuity | 2,817 transitions | 75 | Validated |
| Edge decay | 9,361 references | 75 | Validated |
| Non-coding (pde-book) | 312 MB | 10 | Validation needed |
| Large project (apolitical) | 751 MB | 86 | Cross-session testing |
