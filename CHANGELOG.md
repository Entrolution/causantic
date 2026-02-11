# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-11

### Added
- **Schema v6: Session Reconstruction**: Pure chronological SQLite queries for "what did I work on?" — composite index on `(session_slug, start_time)`, MCP tools `list-sessions` and `reconstruct`
- **Project-Filtered Retrieval**: Federated approach with `projectFilter` on retrieval requests, cross-project graph traversal preserved
- **Collection Benchmark Suite**: Self-service benchmarks for health, retrieval quality, graph value, and latency with scoring, tuning recommendations, and history tracking
- **Web Dashboard**: React + Vite frontend with D3.js graph visualization — 5 pages (Overview, Search, Graph Explorer, Clusters, Projects), 10 API routes
- **CLAUDE.md Generator Hook**: Automatic memory context injection into project CLAUDE.md
- **Hybrid BM25 + Vector Search**: Full-text keyword search via SQLite FTS5 with porter stemming, fused with vector search using Reciprocal Rank Fusion (RRF)
- **Cluster-Guided Expansion**: Retrieval results expanded through HDBSCAN cluster siblings, surfacing topically related chunks
- **Source Attribution**: Returned chunks tagged with retrieval source (`vector`, `keyword`, `cluster`, `graph`)
- **Graph Agreement Boost**: Vector+graph score fusion — when both pipelines agree on a chunk, its score is boosted; `graphBoostedCount` metric added to benchmarks
- **Post-HDBSCAN Noise Reassignment**: Noise points reassigned to nearest cluster via centroid distance, improving cluster coverage
- **6 MCP Tools**: recall, explain, predict, list-projects, list-sessions, reconstruct
- **Schema v5 Migration**: FTS5 virtual table with automatic sync triggers; graceful fallback when FTS5 is unavailable
- Initial open source release
- Core memory ingestion and storage system
- Native TypeScript HDBSCAN clustering
- Claude Code hook integration (session-start, pre-compact, claudemd-generator)
- Graph-based retrieval with hop-based temporal decay
- Vector clock implementation for logical ordering
- Configuration system with JSON schema validation
- Per-chunk encryption (ChaCha20-Poly1305, key stored in system keychain)

### Changed
- **HDBSCAN rewrite**: Pure TypeScript implementation replacing hdbscan-ts — 130× speedup (65 min → 30 sec for 6,000 points)
- **Hop-based decay**: Replaced wall-clock time decay with logical D-T-D hop distance via vector clocks
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
- Graph traversal improvement: 4.65× context augmentation
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
