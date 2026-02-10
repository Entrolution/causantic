# Causantic

Long-term memory system for Claude Code using causal graphs and vector clocks.

<p align="center">
<strong>4.65× the relevant context</strong> vs semantic embedding alone<br/>
<sub>Median 4.54× across 492 queries • Range 3.60× - 5.87×</sub>
</p>

## Why Causantic?

Most AI memory systems use vector embeddings for similarity search. Causantic does too — but adds a **causal graph** that tracks *relationships* between memory chunks. This fundamentally changes what you can retrieve.

| | Vector Search Only | Causantic |
|---|---|---|
| **Finds similar content** | ✓ | ✓ |
| **Finds lexically relevant content** | ✗ | ✓ (BM25 keyword search) |
| **Finds related context** | ✗ | ✓ (causal edges) |
| **Finds topically related context** | ✗ | ✓ (cluster expansion) |
| **Temporal awareness** | Wall-clock decay | Logical hop decay |
| **Context retrieval** | 1× | **4.65×** |
| **Handles project switches** | Breaks continuity | Preserves causality |
| **Bidirectional queries** | Forward only | Backward + Forward |

### Key Differentiators

**1. Hybrid BM25 + Vector Search**

Vector search finds chunks that *look similar*. BM25 keyword search finds chunks with *exact lexical matches* — function names, error codes, CLI flags. Causantic runs both in parallel and fuses results via Reciprocal Rank Fusion (RRF), catching what either search alone would miss.

**2. Causal Graphs, Not Just Vectors**

Causantic also finds chunks that are *causally related* — the debugging session that led to a fix, the error message that triggered investigation, the test that validated a change.

**3. Cluster-Guided Expansion**

HDBSCAN clusters group semantically related chunks. During retrieval, Causantic expands search results through cluster siblings — surfacing topically related context that neither vector nor keyword search found independently.

**4. Hop-Based Decay, Not Wall-Clock Time**

Returning to a project after a weekend shouldn't make yesterday's work seem "old." Causantic measures distance in logical hops (D-T-D transitions), not elapsed time. Monday's work and Tuesday's continuation are 1 hop apart — regardless of the 24-hour gap.

**5. Bidirectional Traversal**

Query backward ("what context led to this?") and forward ("what typically follows this?") with direction-specific decay curves optimized for each use case.

**6. Sum-Product Semantics**

Weights multiply along paths and accumulate across paths — a principled approach (inspired by Feynman path integrals) that handles graph cycles naturally and provides meaningful ranking without arbitrary thresholds.

## Overview

Causantic provides persistent, semantically-aware memory for Claude Code sessions. It captures conversation context, builds causal relationships between chunks of dialogue, and enables intelligent retrieval of relevant historical context.

### Why "Entropic"?

The name reflects how **discrimination degrades along causal paths**. When traversing the graph, edge weights multiply — and since weights are < 1, products converge toward zero. You lose the ability to discriminate between distant nodes. This is entropy flowing along causal lines, implementing natural **causal compression**.

See [Why Entropic?](docs/research/approach/why-entropic.md) for the full explanation.

### Key Features

- **Causal Graph**: Tracks relationships between chunks using 9 edge types with evidence-based weights
- **Vector Clocks**: Measures logical distance in D-T-D hops, not wall-clock time
- **Bidirectional Traversal**: Query backward (causes) and forward (consequences) with direction-specific decay
- **Hybrid Search**: BM25 keyword search + vector embedding search fused via Reciprocal Rank Fusion
- **HDBSCAN Clustering**: Groups related topics; clusters used for retrieval expansion
- **MCP Integration**: Works with Claude Code via Model Context Protocol
- **Hook System**: Automatically captures context at session start and before compaction

## Quick Start

### Prerequisites

- Node.js 20+

### Installation

```bash
# Install the package
npm install causantic

# Initialize Causantic (creates directories, verifies setup)
npx causantic init
```

### Basic Usage

```bash
# Ingest a Claude Code session
npx causantic ingest ~/.claude/projects/my-project

# Batch ingest all sessions
npx causantic batch-ingest ~/.claude/projects

# Query memory
npx causantic recall "authentication flow"

# Start the MCP server
npx causantic serve
```

### Claude Code Integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["causantic", "serve"]
    }
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Session                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Hook System                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │session-start │  │ pre-compact  │  │ claudemd-generator   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Ingestion Pipeline                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────┐   │
│  │  Parser  │→ │ Chunker  │→ │ Embedder   │→ │ Edge Creator │   │
│  └──────────┘  └──────────┘  └────────────┘  └──────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Storage Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   SQLite     │  │   LanceDB    │  │   Vector Clocks      │   │
│  │ (chunks,     │  │ (embeddings) │  │   (logical time)     │   │
│  │  edges)      │  │              │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Retrieval System                              │
│  ┌──────────┐ ┌──────────┐                                      │
│  │ Vector   │ │ Keyword  │  (parallel)                          │
│  │ Search   │ │ (BM25)   │                                      │
│  └────┬─────┘ └────┬─────┘                                      │
│       └──────┬──────┘                                            │
│              ▼                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  RRF Fusion  │→ │ Cluster      │→ │ Graph Traversal      │   │
│  │              │  │ Expansion    │  │ + Context Assembly    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MCP Server                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   recall     │  │   explain    │  │      predict         │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

Create `causantic.config.json` in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "decay": {
    "backward": {
      "type": "linear",
      "diesAtHops": 10
    },
    "forward": {
      "type": "delayed-linear",
      "holdHops": 5,
      "diesAtHops": 20
    }
  },
  "clustering": {
    "threshold": 0.09,
    "minClusterSize": 4
  }
}
```

See [Configuration Reference](docs/reference/configuration.md) for all options.

## MCP Tools

The MCP server exposes three tools:

| Tool | Description |
|------|-------------|
| `recall` | Semantic search with graph-augmented retrieval |
| `explain` | Long-range historical context for complex questions |
| `predict` | Proactive suggestions based on current context |

## Maintenance

```bash
# Run specific maintenance task
npx causantic maintenance run prune-graph

# Check maintenance status
npx causantic maintenance status

# Run as background daemon
npx causantic maintenance daemon
```

## Documentation

- [Getting Started](docs/getting-started/installation.md)
- [User Guides](docs/guides/)
- [API Reference](docs/reference/)
- [Research Documentation](docs/research/)

## Research

This project is built on extensive experimentation across 75 sessions and 492 queries:

| Experiment | Result | Comparison |
|------------|--------|------------|
| Graph Traversal | **4.65×** context | vs vector-only |
| Forward Decay | **3.71×** MRR | vs time-based decay |
| Backward Decay | **1.35×** MRR | vs time-based decay |
| Topic Detection | 0.998 AUC | near-perfect accuracy |
| Clustering | F1=0.940 | 100% precision |

See [Research Documentation](docs/research/) for detailed findings.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

