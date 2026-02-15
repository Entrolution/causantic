# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-02-15

### Changed
- **README**: Clarified that Anthropic API key is optional (only used for cluster topic labeling via Haiku); all core retrieval works without it
- **Skill descriptions**: Sharpened all skill descriptions in README and CLAUDE.md block to clearly differentiate each tool — recall (backward chain walk), predict (forward chain walk), reconstruct (replay), summary (recap), retro (patterns)

## [0.4.1] - 2026-02-15

### Added
- **CLI commands reference in CLAUDE.md block**: Claude Code now knows all 16 CLI commands without needing to run `causantic --help`. Eliminates repeated help lookups during sessions.

### Fixed
- README Key Differentiators numbering (duplicate "5." corrected to "4." and "5.")
- SECURITY.md supported versions updated to v0.4.x only

## [0.4.0] - 2026-02-15

### Changed
- **Episodic Retrieval Pipeline**: Redesigned recall/predict from graph traversal to chain walking. Seeds found by semantic search; the causal graph unfolds them into ordered narrative chains; chains ranked by aggregate semantic relevance per token.
- **Sequential edge structure**: Replaced m×n all-pairs edges with sequential linked-list (intra-turn C1→C2→C3, inter-turn last→first, cross-session last→first). All edges stored as single `forward` rows with uniform weight.
- **MCP tools**: Replaced `explain` with `search` (semantic discovery). `recall` and `predict` now return episodic chain narratives with search-style fallback. Added `hook-status`, `stats`, and `forget` tools. MCP server now exposes 9 tools.
- **Benchmark scoring**: Replaced Graph Value (30%) with Chain Quality (25%). Updated weights: Health 25%, Retrieval 35%, Chain 25%, Latency 15%.
- **Schema v8**: Added composite indices on edges for directional chain walking queries.
- **Skills**: Merged `/causantic-context` into `/causantic-explain` (dual-purpose: "why" questions + area briefings). Rewrote `/causantic-crossref` for explicit cross-project search (discovers projects → per-project filtered search → comparison). Added `/causantic-status`, `/causantic-summary`, and `/causantic-forget`. 14 skills total.
- **Hook consolidation**: Extracted shared `handleIngestionHook()` in `hook-utils.ts` from near-identical `session-end.ts` and `pre-compact.ts`.
- **SessionStart error context**: Fallback message now includes a classified error hint (database busy, database not found, embedder unavailable, internal error) instead of a generic static string.

### Added
- **`/causantic-forget` skill**: Guided memory deletion by topic, time range, or session with dry-run preview and confirmation workflow.
- **Skills reference documentation** (`docs/reference/skills.md`): Reference page for all 14 skills with parameters, usage examples, and decision guide.
- **Semantic deletion for `forget` tool**: Added `query` and `threshold` parameters for topic-based deletion (e.g., "forget everything about authentication"). Uses vector-only search for precision. Dry-run shows top matches with similarity scores and score distribution. Combinable with time/session filters via AND logic.
- **`search` MCP tool**: Pure semantic discovery — vector + keyword + RRF + cluster expansion.
- **`hook-status` MCP tool**: Shows when each hook last ran and whether it succeeded. Use for diagnosing hook firing issues.
- **`stats` MCP tool**: Memory statistics — version, chunk/edge/cluster counts, per-project breakdowns.
- **`forget` MCP tool**: Delete chunks by project, time range, or session. Requires project slug. Defaults to dry-run preview. Cascades to edges, clusters, FTS, and vectors.
- **Chain walk diagnostics**: `recall` and `predict` append a diagnostic bracket on fallback explaining why the chain walker fell back to search (no chunks, no seeds, no edges, short chains, or threshold not met).
- **Chain walker** (`src/retrieval/chain-walker.ts`): Follows directed edges to build ordered narrative chains with token budgeting and cosine-similarity scoring.
- **Chain assembler** (`src/retrieval/chain-assembler.ts`): Seeds → chain walk → rank → best chain or search fallback.
- **Search assembler** (`src/retrieval/search-assembler.ts`): Pure search pipeline extracted from context assembler.
- **Chain quality benchmarks**: Measures chain coverage, mean chain length, score per token, fallback rate.
- **Edge rebuild command**: `npx causantic maintenance rebuild-edges` — rebuilds edges using sequential linked-list structure without re-parsing or re-embedding.
- **claudemd-generator wired to SessionEnd**: The hook now runs automatically after session ingestion, keeping CLAUDE.md up to date.
- **`/causantic-status` skill**: Calls `hook-status` + `stats` MCP tools, presents combined health report.
- **`/causantic-summary` skill**: Summarize recent work across sessions — `list-sessions` → `reconstruct` → synthesize accomplishments/in-progress/patterns.
- **Dashboard Timeline page**: Replaced force-directed graph with D3 horizontal swimlane timeline, chunk inspector, and chain walk viewer.
- **Dashboard chain walk route**: `GET /api/chain/walk` — structural chain walk from a seed chunk for dashboard display.
- **Dashboard timeline route**: `GET /api/timeline` — chunks ordered by time with edges for arc rendering.
- **Removed skill cleanup**: `causantic init` now deletes directories for removed skills (e.g., `causantic-context`) on re-init.

### Removed
- **`explain` MCP tool**: Subsumed by `recall` (both walk backward).
- **`/causantic-context` skill**: Merged into `/causantic-explain`, which now handles both "why" questions and area briefings.
- **Sum-product traverser**: Replaced by chain walker. Deleted `src/retrieval/traverser.ts`.
- **Hop-based decay**: Deleted `src/storage/decay.ts`. Chain scoring uses direct cosine similarity instead.
- **Graph-value benchmarks**: Replaced by chain-quality benchmarks. Deleted `src/eval/collection-benchmark/graph-value.ts`.
- **Config: `decay` section**: Removed entirely from `ExternalConfig` and `config.schema.json`.
- **Config: `traversal.minWeight`**: No longer needed (chain walker uses token budget, not weight-based pruning).
- **Config: `hybridSearch.graphWeight`**: Graph traversal no longer participates in RRF fusion.
- **Dashboard**: Deleted `ForceGraph.tsx`, `DecayCurves.tsx`, `GraphExplorer.tsx` — replaced by Timeline page.

## [0.3.6] - 2026-02-15

### Fixed
- **MCP error messages**: Tool failure responses now include the actual error message instead of generic "Tool execution failed", making transient errors diagnosable without opt-in stderr logging.

### Changed
- **CI formatting enforcement**: Added `format:check` step to CI workflow so formatting drift is caught before merge.
- **Circular dependencies resolved**: Extracted shared types into `src/maintenance/types.ts` and `src/dashboard/client/src/lib/constants.ts` to break 5 circular dependency cycles.

### Housekeeping
- Fixed 5 ESLint warnings (consistent-type-imports, unused imports).
- Bumped typedoc 0.28.16 → 0.28.17 (fixes moderate ReDoS in markdown-it).
- Synced package-lock.json.
- Ran prettier on 19 files with formatting drift.
- Archived stale documentation for removed vector clock and decay systems.

## [0.3.0] - 2026-02-12

### Changed
- **Time-based edge decay**: Replaced vector-clock hop counting with intrinsic time-based edge decay. Each edge's weight decays based on its age (milliseconds since creation), not logical hops. Backward edges use delayed-linear (60-minute hold), forward edges use exponential (10-minute half-life).
- **Broadened vector TTL**: `cleanupExpired()` now applies to ALL vectors, not just orphaned ones. Vectors older than the TTL (default 90 days) are cleaned up regardless of edge status.
- **Simplified traversal**: `traverse()` and `traverseMultiple()` use time-based decay configs directly. Sum-product rules unchanged.

### Added
- **FIFO vector cap**: New `vectors.maxCount` config option evicts oldest vectors when the collection exceeds the limit. Default: 0 (unlimited).

### Removed
- **Vector clocks**: Clock store, clock compactor, and vector-clock module deleted. Vector clock columns dropped from SQLite schema (v7 migration).
- **Graph pruner**: `prune-graph` maintenance task removed. Edge cleanup happens via FK CASCADE when chunks are deleted by TTL/FIFO. Maintenance tasks reduced from 5 to 4.
- **Orphan lifecycle**: Chunks no longer transition through an "orphaned" state. They go directly from active to expired when TTL elapses.

## [0.2.1] - 2026-02-11

### Added
- **SessionEnd hook**: Triggers session ingestion on `/clear`, logout, and exit — closes the gap where chunks were lost between compaction events
- Shared `ingestCurrentSession()` helper extracted from PreCompact, used by both PreCompact and SessionEnd hooks
- Dynamic hook name logging in `causantic init`

## [0.2.0] - 2026-02-11

### Added
- **Schema v6: Session Reconstruction**: Pure chronological SQLite queries for "what did I work on?" — composite index on `(session_slug, start_time)`, MCP tools `list-sessions` and `reconstruct`
- **Project-Filtered Retrieval**: Federated approach with `projectFilter` on retrieval requests, cross-project graph traversal preserved
- **Collection Benchmark Suite**: Self-service benchmarks for health, retrieval quality, graph value, and latency with scoring, tuning recommendations, and history tracking
- **Web Dashboard**: React + Vite frontend with D3.js visualization — 5 pages (Overview, Search, Timeline, Clusters, Projects), 10 API routes
- **CLAUDE.md Generator Hook**: Automatic memory context injection into project CLAUDE.md
- **Hybrid BM25 + Vector Search**: Full-text keyword search via SQLite FTS5 with porter stemming, fused with vector search using Reciprocal Rank Fusion (RRF)
- **Cluster-Guided Expansion**: Retrieval results expanded through HDBSCAN cluster siblings, surfacing topically related chunks
- **Source Attribution**: Returned chunks tagged with retrieval source (`vector`, `keyword`, `cluster`, `graph`)
- **Graph Agreement Boost**: Vector+graph score fusion — when both pipelines agree on a chunk, its score is boosted; `graphBoostedCount` metric added to benchmarks
- **Post-HDBSCAN Noise Reassignment**: Noise points reassigned to nearest cluster via centroid distance, improving cluster coverage
- **6 MCP Tools** (v0.2.0): recall, explain, predict, list-projects, list-sessions, reconstruct (Note: `explain` was later replaced by `search`; `hook-status`, `stats`, and `forget` added in v0.4.0)
- **Schema v5 Migration**: FTS5 virtual table with automatic sync triggers; graceful fallback when FTS5 is unavailable
- Initial open source release
- Core memory ingestion and storage system
- Native TypeScript HDBSCAN clustering
- Claude Code hook integration (session-start, pre-compact, claudemd-generator)
- Graph-based retrieval with hop-based temporal decay
- Time-based edge decay for temporal weighting
- Configuration system with JSON schema validation
- Per-chunk encryption (ChaCha20-Poly1305, key stored in system keychain)

### Changed
- **HDBSCAN rewrite**: Pure TypeScript implementation replacing hdbscan-ts — 130× speedup (65 min → 30 sec for 6,000 points)
- **Direction-specific decay**: Backward and forward edges use different decay curves (empirically tuned)
- **MCP tools**: Expanded from 3 to 6 tools (added list-projects, list-sessions, reconstruct)
- **Clustering threshold**: Tuned default from 0.09 → 0.10

### Fixed
- README config example: corrected stale `clustering.threshold` default value

### Infrastructure
- Utility deduplication and standardized logging
- ESLint no-console rule for consistent log handling
- Test coverage: 1,684 tests passing in vitest

### Research Findings
- Topic continuity detection: 0.998 AUC
- Clustering threshold optimization: F1=0.940 at 0.09
- Graph traversal experiment: 4.65× context augmentation (v0.2 sum-product; replaced by chain walking in v0.4.0)
- Embedding model selection: jina-small for optimal size/quality tradeoff
- Direction-specific decay: backward (dies@10 hops) vs forward (5-hop hold, dies@20)

## [0.1.0] - 2026-02-08

### Added
- Initial release
- Session parsing and chunking
- Embedding generation with jina-small
- SQLite storage for chunks and edges
- LanceDB vector store
- Basic graph traversal
- HDBSCAN clustering integration
- MCP server prototype
