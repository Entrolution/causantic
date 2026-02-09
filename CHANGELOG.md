# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open source release
- Core memory ingestion and storage system
- HDBSCAN clustering with Python bridge for performance
- MCP server with recall, explain, and predict tools
- Claude Code hook integration (session-start, pre-compact)
- Graph-based retrieval with temporal decay
- Vector clock implementation for logical ordering
- Configuration system with JSON schema validation

### Research Findings
- Topic continuity detection: 0.998 AUC
- Clustering threshold optimization: F1=0.940 at 0.09
- Graph traversal improvement: 221% context augmentation with lazy pruning
- Embedding model selection: jina-small for optimal size/quality tradeoff

## [0.1.0] - 2024-02-08

### Added
- Initial release
- Session parsing and chunking
- Embedding generation with jina-small
- SQLite storage for chunks and edges
- LanceDB vector store
- Basic graph traversal
- HDBSCAN clustering integration
- MCP server prototype
