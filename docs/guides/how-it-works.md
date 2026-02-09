# How It Works

This guide explains the architecture and design of Entropic Causal Memory.

## Core Concepts

### Chunks

ECM breaks Claude Code sessions into **chunks** - semantic units of conversation. Each chunk contains:

- Content (conversation text)
- Embeddings (vector representation)
- Vector clock (logical timestamp)
- Session metadata

### Causal Graph

Chunks are connected in a **causal graph** that tracks relationships:

- **Backward edges**: "This chunk references that earlier chunk"
- **Forward edges**: "That later chunk builds on this one"

Edge types include:
- `file-path`: References to the same file
- `adjacent`: Sequential chunks in a session
- `topic`: Semantically related content

### Vector Clocks

Instead of wall-clock time, ECM uses **vector clocks** to track logical ordering:

```
D-T-D Semantics:
D = Human input (Decision)
T = Claude's response (Thought)
D = Tool execution (Do)
```

This enables "hop distance" calculations that reflect semantic distance rather than time elapsed.

### Temporal Decay

Edge weights decay based on **hop distance**, not time:

```
Backward decay (historical):
  - Linear: weight = 1 - (hops / diesAtHops)
  - Dies at 10 hops

Forward decay (predictive):
  - Delayed linear: hold at 1.0 for 5 hops, then decay
  - Dies at 20 hops
```

## Data Flow

```
1. Session Start
   ├── Hook fires
   ├── Generate memory summary
   └── Update CLAUDE.md

2. During Session
   ├── Claude uses MCP tools
   ├── recall: semantic search + graph traversal
   ├── explain: long-range historical context
   └── predict: proactive suggestions

3. Session End / Compaction
   ├── Pre-compact hook fires
   ├── Ingest session content
   ├── Create chunks and edges
   ├── Generate embeddings
   └── Update clusters
```

## Retrieval Process

When Claude uses the `recall` tool:

1. **Vector search**: Find chunks similar to the query
2. **Graph traversal**: Follow edges from seed chunks
3. **Decay weighting**: Apply temporal decay to edges
4. **Context assembly**: Rank and format results
5. **Token budgeting**: Fit within response limits

## Clustering

HDBSCAN groups similar chunks into **clusters**:

- Automatic topic detection
- No preset number of clusters
- Handles noise (unclustered chunks)
- Optional: LLM-generated cluster descriptions

## Storage

ECM uses two storage backends:

- **SQLite**: Chunks, edges, clusters, metadata
- **LanceDB**: Vector embeddings for similarity search

Default location: `~/.ecm/`

## See Also

- [Integration](integration.md) - Hooks and MCP setup
- [Configuration](../getting-started/configuration.md) - Tune parameters
- [Research](../research/README.md) - Detailed technical findings
