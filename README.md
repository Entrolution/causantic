# Causantic

[![npm version](https://img.shields.io/npm/v/causantic)](https://www.npmjs.com/package/causantic)
[![CI](https://github.com/Entrolution/causantic/actions/workflows/ci.yml/badge.svg)](https://github.com/Entrolution/causantic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-native-blue)](https://www.typescriptlang.org/)

**Long-term memory for Claude Code — local-first, graph-augmented, self-benchmarking.**

No cloud. No API keys. No data leaves your machine. Runs entirely on your hardware with optional per-chunk encryption.

<p align="center">
<strong>Long-term episodic memory for Claude Code</strong><br/>
<sub>Local-first · Hybrid BM25 + vector search · Causal chain walking</sub>
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
| **Temporal awareness** | Wall-clock decay | Episodic chain walking |
| **Context augmentation** | 1× | **2.46×** (chain walking adds episodic narrative) |
| **Handles project switches** | Breaks continuity | Preserves causality |
| **Bidirectional queries** | Forward only | Backward + Forward |

### How It Compares

| System | Local-First | Temporal Decay | Graph Structure | Self-Benchmarking |
|--------|:-----------:|:--------------:|:--------------:|:-----------------:|
| **Causantic** | **Yes** | **Chain walking** | **Causal graph** | **Yes** |
| Mem0 | No (Cloud) | None | Paid add-on | No |
| Cognee | Self-hostable | None | Triplet extraction | No |
| Letta/MemGPT | Self-hostable | Summarization | None | No |
| Zep | Enterprise | Bi-temporal | Temporal KG | No |
| GraphRAG | Self-hostable | Static corpus | Hierarchical | No |

See [Landscape Analysis](docs/research/approach/landscape-analysis.md) for detailed per-system analysis.

## Key Differentiators

**1. Local-First with Encryption**
All data stays on your machine. Optional per-chunk encryption (ChaCha20-Poly1305) with keys stored in your system keychain. No cloud dependency.

**2. Hybrid BM25 + Vector Search**
Vector search finds chunks that *look similar*. BM25 keyword search finds chunks with *exact lexical matches* — function names, error codes, CLI flags. Both run in parallel and fuse via Reciprocal Rank Fusion (RRF).

**3. Sequential Causal Graph with Episodic Chain Walking**
Chunks are connected in a sequential linked list — intra-turn chunks chained sequentially, inter-turn edges linking last→first, cross-session edges bridging sessions. The `recall` tool walks this graph backward to reconstruct episodic narratives; `predict` walks forward. Chains are scored by cosine similarity per token, producing ordered narratives where each chunk adds new information.

**4. HDBSCAN Cluster-Guided Expansion**
Topic clusters group semantically related chunks. During retrieval, results expand through cluster siblings — surfacing context that neither vector nor keyword search found independently. Native TypeScript implementation (130× faster than hdbscan-ts).

**5. Self-Benchmarking Suite**
Measure how well your memory system is working with built-in benchmarks. Health, retrieval quality, chain quality, and latency — scored and tracked over time with specific tuning recommendations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Session                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Hook System                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐            │
│  │session-start │  │ session-end  │  │ pre-compact │            │
│  └──────────────┘  └──────────────┘  └─────────────┘            │
│  ┌──────────────────────┐                                        │
│  │ claudemd-generator   │                                        │
│  └──────────────────────┘                                        │
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
│  ┌──────────────┐  ┌──────────────┐                        │
│  │   SQLite     │  │   LanceDB    │                        │
│  │ (chunks,     │  │ (embeddings) │                        │
│  │  edges, FTS5)│  │              │                        │
│  └──────────────┘  └──────────────┘                        │
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
│  │  RRF Fusion  │→ │ Cluster      │→ │ Chain Walker         │   │
│  │              │  │ Expansion    │  │ + Context Assembly    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MCP Server                                 │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌───────────┐ ┌───────────┐ │
│  │ search │ │ recall │ │ predict │ │list-      │ │list-      │ │
│  │        │ │        │ │         │ │projects   │ │sessions   │ │
│  └────────┘ └────────┘ └─────────┘ └───────────┘ └───────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌───────┐ ┌────────┐          │
│  │ reconstruct │ │ hook-status │ │ stats │ │ forget │          │
│  └─────────────┘ └─────────────┘ └───────┘ └────────┘          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Web Dashboard                                │
│  ┌──────────┐ ┌────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ │
│  │ Overview │ │Timeline│ │ Search    │ │ Clusters │ │Projects│ │
│  │          │ │        │ │           │ │          │ │        │ │
│  └──────────┘ └────────┘ └───────────┘ └──────────┘ └────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## MCP Tools

The MCP server exposes nine tools:

| Tool | Description |
|------|-------------|
| `search` | Semantic discovery — "what do I know about X?" Vector + keyword + RRF + cluster expansion. |
| `recall` | Episodic memory — "how did we solve X?" Seeds → backward chain walk → ordered narrative. Includes chain walk diagnostics on fallback. |
| `predict` | Forward episodic — "what's likely next?" Seeds → forward chain walk → ordered narrative. Includes chain walk diagnostics on fallback. |
| `list-projects` | Discover available projects with chunk counts and date ranges. |
| `list-sessions` | Browse sessions for a project with time filtering. |
| `reconstruct` | Rebuild session context chronologically — "what did I work on yesterday?" |
| `hook-status` | Check when hooks last ran and whether they succeeded. |
| `stats` | Memory statistics — version, chunk/edge/cluster counts, per-project breakdowns. |
| `forget` | Delete chunks by project, time range, session, or semantic query. Defaults to dry-run preview. |

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

Causantic installs 14 Claude Code slash commands (via `npx causantic init`) for natural-language interaction with memory:

| Skill | Description |
|-------|-------------|
| `/causantic-recall [query]` | Walk causal chains to reconstruct narrative (how did we solve X?) |
| `/causantic-search [query]` | Ranked discovery across memory by relevance (what do I know about X?) |
| `/causantic-predict <context>` | Surface relevant past context proactively for a given task |
| `/causantic-explain [question]` | Answer "why" questions and explore codebase areas |
| `/causantic-debug [error]` | Search for prior encounters with an error (auto-extracts from conversation if no argument) |
| `/causantic-resume` | Resume interrupted work — start-of-session briefing |
| `/causantic-reconstruct [time]` | Reconstruct session context by time range |
| `/causantic-summary [time]` | Summarize recent work across sessions |
| `/causantic-list-projects` | Discover available projects in memory |
| `/causantic-status` | Check system health and memory statistics |
| `/causantic-crossref [pattern]` | Search across all projects for reusable patterns |
| `/causantic-retro [scope]` | Retrospective analysis across past sessions |
| `/causantic-cleanup` | Memory-informed codebase review and cleanup plan |
| `/causantic-forget [query]` | Delete memory by topic, time range, or session (always previews first) |

Skills are installed to `~/.claude/skills/causantic-*/` and work as slash commands in Claude Code. They orchestrate the MCP tools above with structured prompts tailored to each use case.

## Dashboard

Explore your memory visually:

```bash
npx causantic dashboard
```

Opens at [http://localhost:3333](http://localhost:3333) with 5 pages: Overview (collection stats), Timeline (D3.js swimlane visualization with chain walking), Search (query memory), Clusters (topic browser), and Projects (per-project breakdowns).

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

Scores health, retrieval quality, chain quality, and latency — with specific tuning recommendations. Track improvements over time with `--history`.

See [Benchmarking Guide](docs/guides/benchmarking.md).

## Configuration

Create `causantic.config.json` in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "clustering": {
    "threshold": 0.10,
    "minClusterSize": 4
  },
  "vectors": {
    "ttlDays": 90
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
- [Skills Reference](docs/reference/skills.md) — All 14 slash commands
- [Configuration Reference](docs/reference/configuration.md) — All configuration options
- [Research Documentation](docs/research/) — Experiment results and design decisions
- [Design Decision Log](docs/research/decisions.md) — Why things are the way they are

## Research

Built on rigorous experimentation across 75 sessions and 297+ queries:

| Experiment | Result | Notes |
|------------|--------|-------|
| Chain Walking (v0.3) | **2.46×** context | vs vector-only, 297 queries, 15 projects |
| Topic Detection | 0.998 AUC | near-perfect accuracy |
| Clustering | F1=0.940 | 100% precision |
| Thinking Block Removal | +0.063 AUC | embedding quality improvement |
| Collection Benchmark | **64/100** | health, retrieval, chain quality, latency |

> **Note**: An earlier version (v0.2) reported 4.65× augmentation using sum-product graph traversal with m×n all-pairs edges (492 queries, 25 projects). That architecture was replaced in v0.3 after collection benchmarks showed graph traversal contributing only ~2% of results. See [lessons learned](docs/research/experiments/lessons-learned.md) for the full story.

See [Research Documentation](docs/research/) for detailed findings, and the [Design Decision Log](docs/research/decisions.md) for the story of how each decision was made.

### Why "Causantic"?

The name reflects how the causal graph's value is **structural ordering** — what came before and after — not semantic ranking. Chunks are connected in sequential chains that preserve episodic narrative structure. The graph encodes causality (what led to what), while semantic search handles relevance (what's similar to what). This separation of concerns emerged from the research: sum-product path products converge to zero too fast to compete with direct vector/keyword search, but the graph's structural ordering produces coherent narratives that ranked search alone cannot.

## Limitations

- **First-call latency**: The embedding model downloads on first use (~500MB). Subsequent calls are fast (~80ms).
- **Initial ingestion time**: Large session histories take time to parse, embed, and cluster. This is a one-time cost.
- **Edge quality dependency**: Chain walking depends on connected edges. Sparse or orphaned chunks fall back to ranked search results.
- **Collection size effects**: Benchmark scores improve as more sessions are ingested. Small collections (<100 chunks) won't benefit much from chain walking or clustering.
- **Claude Code specific**: The parser assumes Claude Code session format (JSONL transcripts). Not a general-purpose memory system.
- **Local compute**: Embedding inference runs on your hardware. Apple Silicon (CoreML) and NVIDIA GPUs are supported; CPU-only is slower.

## Maintenance

```bash
# Check maintenance status
npx causantic maintenance status

# Run all maintenance tasks
npx causantic maintenance run all

# Run as background daemon
npx causantic maintenance daemon
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
