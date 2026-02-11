# Causantic

[![npm version](https://img.shields.io/npm/v/causantic)](https://www.npmjs.com/package/causantic)
[![CI](https://github.com/Entrolution/causantic/actions/workflows/ci.yml/badge.svg)](https://github.com/Entrolution/causantic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-native-blue)](https://www.typescriptlang.org/)

**Long-term memory for Claude Code — local-first, graph-augmented, self-benchmarking.**

No cloud. No API keys. No data leaves your machine. Runs entirely on your hardware with optional per-chunk encryption.

<p align="center">
<strong>4.65× the relevant context</strong> vs semantic embedding alone<br/>
<sub>Median 4.54× across 492 queries · Range 3.60× – 5.87×</sub>
</p>

## Quick Start

```bash
# Install
npm install causantic

# Initialize (creates dirs, configures MCP, offers to import sessions)
npx causantic init

# Query memory
npx causantic recall "authentication flow"

# Launch the dashboard
npx causantic dashboard
```

## Who Is This For?

Developers using Claude Code who want their AI assistant to **remember across sessions**. When you switch projects, return after a weekend, or need context from three sessions ago, Causantic retrieves the right history automatically.

## Why Causantic?

Most AI memory systems use vector embeddings for similarity search. Causantic does too — but adds a **causal graph** that tracks *relationships* between memory chunks, **BM25 keyword search** for exact matches, and **HDBSCAN clustering** for topic expansion. The result:

| | Vector Search Only | Causantic |
|---|---|---|
| **Finds similar content** | Yes | Yes |
| **Finds lexically relevant content** | No | Yes (BM25 keyword search) |
| **Finds related context** | No | Yes (causal edges) |
| **Finds topically related context** | No | Yes (cluster expansion) |
| **Temporal awareness** | Wall-clock decay | Logical hop decay |
| **Context retrieval** | 1× | **4.65×** |
| **Handles project switches** | Breaks continuity | Preserves causality |
| **Bidirectional queries** | Forward only | Backward + Forward |

### How It Compares

| System | Local-First | Temporal Decay | Graph Structure | Self-Benchmarking | Hop-Based Distance |
|--------|:-----------:|:--------------:|:--------------:|:-----------------:|:------------------:|
| **Causantic** | **Yes** | **Hop-based** | **9-type causal** | **Yes** | **Yes** |
| Mem0 | No (Cloud) | None | Paid add-on | No | No |
| Cognee | Self-hostable | None | Triplet extraction | No | No |
| Letta/MemGPT | Self-hostable | Summarization | None | No | No |
| Zep | Enterprise | Bi-temporal | Temporal KG | No | No |
| GraphRAG | Self-hostable | Static corpus | Hierarchical | No | No |

See [Landscape Analysis](docs/research/approach/landscape-analysis.md) for detailed per-system analysis.

## Key Differentiators

**1. Local-First with Encryption**
All data stays on your machine. Optional per-chunk encryption (ChaCha20-Poly1305) with keys stored in your system keychain. No cloud dependency.

**2. Hybrid BM25 + Vector Search**
Vector search finds chunks that *look similar*. BM25 keyword search finds chunks with *exact lexical matches* — function names, error codes, CLI flags. Both run in parallel and fuse via Reciprocal Rank Fusion (RRF).

**3. Causal Graphs with 9 Evidence-Weighted Edge Types**
Chunks are connected by file-path references, code entities, explicit backreferences, error fragments, topic continuity, and more. Each edge type has an empirically determined weight. The graph finds chunks that are *causally related* — not just similar.

**4. Hop-Based Decay with Direction-Specific Curves**
Returning to a project after a weekend shouldn't make yesterday's work seem "old." Distance is measured in logical D-T-D hops, not elapsed time. Backward edges (dies@10 hops, 1.35× MRR vs exponential) and forward edges (5-hop hold, dies@20, 3.71× MRR) use different decay profiles.

**5. HDBSCAN Cluster-Guided Expansion**
Topic clusters group semantically related chunks. During retrieval, results expand through cluster siblings — surfacing context that neither vector nor keyword search found independently. Native TypeScript implementation (130× faster than hdbscan-ts).

**6. Self-Benchmarking Suite**
Measure how well your memory system is working with built-in benchmarks. Health, retrieval quality, graph value, and latency — scored and tracked over time with specific tuning recommendations.

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
│  │  edges, FTS5)│  │              │  │                      │   │
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
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌───────────┐ ┌───────────┐ │
│  │ recall │ │explain │ │ predict │ │list-      │ │list-      │ │
│  │        │ │        │ │         │ │projects   │ │sessions   │ │
│  └────────┘ └────────┘ └─────────┘ └───────────┘ └───────────┘ │
│  ┌─────────────┐                                                │
│  │ reconstruct │                                                │
│  └─────────────┘                                                │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Web Dashboard                                │
│  ┌──────────┐ ┌────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ │
│  │ Overview │ │ Search │ │ Graph     │ │ Clusters │ │Projects│ │
│  │          │ │        │ │ Explorer  │ │          │ │        │ │
│  └──────────┘ └────────┘ └───────────┘ └──────────┘ └────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## MCP Tools

The MCP server exposes six tools:

| Tool | Description |
|------|-------------|
| `recall` | Semantic search with graph-augmented retrieval. Supports `range` (short/long) and `project` filtering. |
| `explain` | Long-range historical context for complex questions. Default: long-range retrieval. |
| `predict` | Proactive suggestions based on current context. |
| `list-projects` | Discover available projects with chunk counts and date ranges. |
| `list-sessions` | Browse sessions for a project with time filtering. |
| `reconstruct` | Rebuild session context chronologically — "what did I work on yesterday?" |

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

Or run `npx causantic init` to configure automatically.

## Skills

Causantic installs 11 Claude Code slash commands (via `npx causantic init`) for natural-language interaction with memory:

| Skill | Description |
|-------|-------------|
| `/causantic-recall [query]` | Look up context from past sessions |
| `/causantic-explain [topic]` | Understand history behind decisions |
| `/causantic-predict` | Surface relevant past context proactively |
| `/causantic-resume` | Resume interrupted work — start-of-session briefing |
| `/causantic-debug [error]` | Search for prior encounters with an error (auto-extracts from conversation if no argument) |
| `/causantic-context [area]` | Deep dive into a codebase area's history and decisions |
| `/causantic-crossref [pattern]` | Search across all projects for reusable patterns |
| `/causantic-retro [scope]` | Retrospective analysis across past sessions |
| `/causantic-cleanup` | Memory-informed codebase review and cleanup plan |
| `/causantic-list-projects` | Discover available projects in memory |
| `/causantic-reconstruct [time]` | Reconstruct session context by time range |

Skills are installed to `~/.claude/skills/causantic-*/` and work as slash commands in Claude Code. They orchestrate the MCP tools above with structured prompts tailored to each use case.

## Dashboard

Explore your memory visually:

```bash
npx causantic dashboard
```

Opens at [http://localhost:3333](http://localhost:3333) with 5 pages: Overview (collection stats), Search (query memory), Graph Explorer (D3.js visualization), Clusters (topic browser), and Projects (per-project breakdowns).

See [Dashboard Guide](docs/guides/dashboard.md).

## Benchmarking

Measure how well your memory system is working:

```bash
# Quick health check (~1 second)
npx causantic benchmark-collection --quick

# Standard benchmark (~30 seconds)
npx causantic benchmark-collection

# Full benchmark with graph value and latency (~2-5 minutes)
npx causantic benchmark-collection --full
```

Scores health (20%), retrieval quality (35%), graph value (30%), and latency (15%) — with specific tuning recommendations. Track improvements over time with `--history`.

See [Benchmarking Guide](docs/guides/benchmarking.md).

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
    "threshold": 0.10,
    "minClusterSize": 4
  }
}
```

See [Configuration Reference](docs/reference/configuration.md) for all options.

## Security

- **Per-chunk encryption**: ChaCha20-Poly1305 with keys stored in your system keychain
- **Local-only storage**: SQLite + LanceDB on your filesystem, no cloud sync
- **Embedding vector protection**: Encrypted vectors prevent semantic reconstruction

See [Security Guide](docs/guides/security.md).

## Documentation

- [Getting Started](docs/getting-started/installation.md) — Installation and setup
- [User Guides](docs/guides/) — Dashboard, benchmarking, integration, security, maintenance
- [CLI Reference](docs/reference/cli-commands.md) — All commands and options
- [MCP Tools Reference](docs/reference/mcp-tools.md) — Tool schemas and usage
- [Configuration Reference](docs/reference/configuration.md) — All configuration options
- [Research Documentation](docs/research/) — Experiment results and design decisions
- [Design Decision Log](docs/research/decisions.md) — Why things are the way they are

## Research

Built on rigorous experimentation across 75 sessions and 492 queries:

| Experiment | Result | Comparison |
|------------|--------|------------|
| Graph Traversal | **4.65×** context | vs vector-only |
| Forward Decay | **3.71×** MRR | vs time-based decay |
| Backward Decay | **1.35×** MRR | vs time-based decay |
| Topic Detection | 0.998 AUC | near-perfect accuracy |
| Clustering | F1=0.940 | 100% precision |
| Thinking Block Removal | +0.063 AUC | embedding quality improvement |

See [Research Documentation](docs/research/) for detailed findings, and the [Design Decision Log](docs/research/decisions.md) for the story of how each decision was made.

### The Role of Entropy

The name reflects how **discrimination degrades along causal paths** — the same way information diffuses with each causal jump.

Chunks close to your query point are sharply ranked: the graph can clearly distinguish what's most relevant. But as traversal moves outward, edge weights multiply — and since each weight is < 1, the products converge toward zero. You progressively lose the ability to discriminate between distant nodes. This is entropy flowing along causal lines.

This isn't a limitation — it's the design. The loss of discriminating power:

- **Prevents unbounded graph growth**: distant, low-discrimination regions naturally fade rather than accumulating indefinitely
- **Keeps memory current**: the graph evolves with your usage of Claude — recent causal paths retain sharp discrimination while older paths gracefully compress
- **Mirrors how relevance actually works**: the further a piece of context is from your current work (in causal hops, not wall-clock time), the less precisely it needs to be ranked

The result is **natural causal compression** — a graph that stays focused on what matters without manual pruning or arbitrary cutoffs.

See [The Role of Entropy](docs/research/approach/role-of-entropy.md) for the full explanation.

## Maintenance

```bash
# Run specific maintenance task
npx causantic maintenance run prune-graph

# Check maintenance status
npx causantic maintenance status

# Run as background daemon
npx causantic maintenance daemon
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
