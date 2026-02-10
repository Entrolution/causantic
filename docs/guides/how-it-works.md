# How It Works

This guide explains the architecture and design of Causantic.

## Core Concepts

### Chunks

Causantic breaks Claude Code sessions into **chunks** - semantic units of conversation. Each chunk contains:

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

Instead of wall-clock time, Causantic uses **vector clocks** to track logical ordering:

```
D-T-D Semantics (Data-Transformation-Data):
D = Data (input)
T = Transformation (any processing step)
D = Data (output)
```

D-T-D abstractly represents any `f(input) → output` operation - whether that's Claude reasoning, human thinking, or tool execution. This representation works well for graph-based reasoning without getting bogged down in type systems or composition semantics.

Each thought stream has its own vector clock entry:

```typescript
{
  "ui": 5,           // Main agent: 5 D-T-D cycles
  "human": 3,        // Human thinking/input cycles
  "agent-abc": 2     // Sub-agent thought stream
}
```

This enables "hop distance" calculations that reflect semantic distance rather than time elapsed. Parallel thought streams are tracked independently, then merged when they complete.

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

1. **Embed query**: Generate vector embedding for the query
2. **Parallel search**: Run vector search and BM25 keyword search simultaneously
3. **RRF fusion**: Merge both ranked lists using Reciprocal Rank Fusion (k=60)
4. **Cluster expansion**: Expand results through HDBSCAN cluster siblings
5. **Graph traversal**: Follow causal edges from seed chunks with hop-based decay
6. **Context assembly**: Rank, deduplicate, and format results with source attribution
7. **Token budgeting**: Fit within response limits

### Hybrid Search

Causantic uses two complementary search strategies:

- **Vector search** finds chunks with similar semantic meaning (e.g., "auth flow" matches "login handler")
- **BM25 keyword search** finds chunks with exact lexical matches (e.g., function names, error codes, CLI flags)

Results are fused using Reciprocal Rank Fusion, which combines ranked lists without requiring score normalization. Chunks appearing in both searches get a natural boost.

### Cluster-Guided Expansion

After fusion, Causantic expands results through cluster siblings. If a search hit belongs to a topic cluster, other chunks in that cluster are added as candidates with a reduced score. This surfaces topically related context that neither search found independently.

### Source Attribution

Each returned chunk is tagged with its retrieval source (`vector`, `keyword`, `cluster`, or `graph`), enabling debugging and tuning of fusion weights.

### Graceful Degradation

If FTS5 keyword search is unavailable (e.g., SQLite built without FTS5 support), the pipeline falls back to vector-only search without error.

## Clustering

HDBSCAN groups similar chunks into **clusters**:

- Automatic topic detection
- No preset number of clusters
- Handles noise (unclustered chunks)
- Optional: LLM-generated cluster descriptions
- Used during retrieval for cluster-guided expansion (sibling chunks surface related context)

## Storage

Causantic uses two storage backends:

- **SQLite**: Chunks, edges, clusters, metadata
- **LanceDB**: Vector embeddings for similarity search

Default location: `~/.causantic/`

## See Also

- [Integration](integration.md) - Hooks and MCP setup
- [Configuration](../getting-started/configuration.md) - Tune parameters
- [Research](../research/README.md) - Detailed technical findings
