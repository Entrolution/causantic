# Entropic Causal Memory

Long-term memory system for Claude Code using causal graphs and vector clocks.

## Overview

Entropic Causal Memory (ECM) provides persistent, semantically-aware memory for Claude Code sessions. It captures conversation context, builds causal relationships between chunks of dialogue, and enables intelligent retrieval of relevant historical context.

### Why "Entropic"?

The name reflects a core design principle: **memory decay flows along causal lines, not along a global clock**.

Like thermodynamic entropy, information relevance degrades along causal pathways. ECM measures distance in "hops" (D-T-D transitions) rather than wall-clock time. This means:

- Returning to a topic after days still shows high relevance if causally connected
- Interleaved work maintains proper causal ordering
- Edge weight decay implements **causal compression** — older, causally-distant information naturally fades while proximate context is preserved

The graph structure itself encodes temporal dynamics: edge accumulation reflects co-occurrence frequency, decay reflects causal recency, and path products encode causal distance. The graph *is* the clock.

See [Why Entropic?](docs/research/approach/why-entropic.md) for the full explanation.

### Key Features

- **Causal Graph**: Tracks relationships between conversation chunks using vector clocks for logical ordering
- **Semantic Search**: Find relevant context using embedding-based similarity search
- **HDBSCAN Clustering**: Automatically groups related topics for better organization
- **Temporal Decay**: Weights fade based on logical distance, not wall-clock time
- **MCP Integration**: Works with Claude Code via Model Context Protocol
- **Hook System**: Automatically captures context at session start and before compaction

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.8+ with pip (for fast clustering)

### Installation

```bash
# Install the package
npm install entropic-causal-memory

# Install Python dependencies (optional but recommended - 220x faster clustering)
pip install hdbscan numpy
```

### Basic Usage

```bash
# Ingest a Claude Code session
npx ecm ingest ~/.claude/projects/my-project

# Batch ingest all sessions
npx ecm batch-ingest ~/.claude/projects

# Query memory
npx ecm recall "authentication flow"

# Start the MCP server
npx ecm serve
```

### Claude Code Integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["ecm", "serve"]
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
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Vector       │→ │ Graph        │→ │ Context              │   │
│  │ Search       │  │ Traversal    │  │ Assembly             │   │
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

Create `ecm.config.json` in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/entropic-causal-memory/main/config.schema.json",
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
npx ecm maintenance run prune-graph

# Check maintenance status
npx ecm maintenance status

# Run as background daemon
npx ecm maintenance daemon
```

## Documentation

- [Getting Started](docs/getting-started/installation.md)
- [User Guides](docs/guides/)
- [API Reference](docs/reference/)
- [Research Documentation](docs/research/)

## Research

This project is built on extensive experimentation:

- **Topic Continuity**: 0.998 AUC for session boundary detection
- **Clustering**: F1=0.940 at angular threshold 0.09
- **Graph Traversal**: 221% context augmentation with lazy pruning
- **Embedding Model**: Jina-small selected after benchmark comparison

See [Research Documentation](docs/research/) for detailed findings.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

