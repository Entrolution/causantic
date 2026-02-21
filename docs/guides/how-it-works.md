# How It Works

This guide explains the architecture and design of Causantic.

## Core Concepts

### Chunks

Causantic breaks Claude Code sessions into **chunks** - semantic units of conversation. Each chunk contains:

- Content (conversation text)
- Embeddings (vector representation)
- Session metadata

### Causal Graph

Chunks are connected in a **sequential causal graph** — a linked list with branch points at sub-agent forks:

- **Intra-turn**: Chunks within the same turn are linked sequentially (C1→C2→C3)
- **Inter-turn**: Last chunk of turn A → first chunk of turn B
- **Brief/Debrief**: Parent ↔ sub-agent spawn/return edges
- **Team edges**: Lead ↔ teammate spawn/report edges, plus peer-to-peer messaging edges between teammates
- **Cross-session**: Last chunk of previous session → first chunk of new session

All edges are stored as single `forward` rows — direction is inferred at query time (backward = follow edges where the chunk is the target).

## Data Flow

```
1. Session Start
   ├── Hook fires
   ├── Generate memory summary
   └── Update CLAUDE.md

2. During Session
   ├── Claude uses MCP tools
   ├── search: semantic discovery ("what do I know about X?")
   ├── recall: episodic memory ("how did we solve the auth bug?")
   └── predict: forward episodic ("what's likely next?")

3. Session End / Compaction
   ├── Pre-compact hook fires
   ├── Ingest session content
   ├── Create chunks and edges
   ├── Generate embeddings
   └── Update clusters
```

## Retrieval Process

Causantic has two retrieval modes:

### Search (discovery)

The `search` tool finds semantically similar context:

1. **Embed query**: Generate vector embedding for the query
2. **Parallel search**: Run vector search and BM25 keyword search simultaneously
3. **RRF fusion**: Merge both ranked lists using Reciprocal Rank Fusion (k=60)
4. **Cluster expansion**: Expand results through HDBSCAN cluster siblings
5. **Rank and deduplicate**: Recency boost, deduplication
6. **MMR reranking**: Reorder candidates using Maximal Marginal Relevance to balance relevance with diversity
7. **Token budgeting**: Fit within response limits

### Recall/Predict (episodic)

The `recall` and `predict` tools reconstruct narrative chains:

1. **Seed discovery**: Same as search (embed → vector + keyword → RRF → cluster expand) to find top 5 seeds
2. **Chain walking**: For each seed, walk the causal graph (backward for recall, forward for predict), building ordered chains
3. **Chain scoring**: Each chain scored by Σ cosine_similarity(query, node) / token_count
4. **Best chain selection**: Highest score-per-token among chains with ≥ 2 chunks
5. **Fallback**: If no qualifying chain found, fall back to search-style results

### Hybrid Search

Causantic uses two complementary search strategies:

- **Vector search** finds chunks with similar semantic meaning (e.g., "auth flow" matches "login handler")
- **BM25 keyword search** finds chunks with exact lexical matches (e.g., function names, error codes, CLI flags)

Results are fused using Reciprocal Rank Fusion, which combines ranked lists without requiring score normalization. Chunks appearing in both searches get a natural boost.

### Cluster-Guided Expansion

After fusion, Causantic expands results through cluster siblings. If a search hit belongs to a topic cluster, other chunks in that cluster are added as candidates, scored by their proximity to the cluster centroid. This surfaces topically related context that neither search found independently. MMR reranking (below) then decides whether these siblings add enough novelty to justify inclusion.

### MMR Reranking

After fusion and cluster expansion, candidates are reordered using Maximal Marginal Relevance (MMR). MMR scores each candidate as:

```
MMR(c) = λ × relevance − (1−λ) × max_similarity(c, already_selected)
```

The first pick is always the top relevance hit. As selected items saturate a semantic neighbourhood, candidates from different topics become competitive — including cluster siblings that cover the same topic from a different angle. This benefits all search results, not just cluster expansion: even without clusters, MMR prevents near-duplicate vector hits from monopolising the token budget.

Controlled by `retrieval.mmrLambda` (default: 0.7). See [Configuration Reference](../reference/configuration.md#retrieval).

### Graceful Degradation

If FTS5 keyword search is unavailable (e.g., SQLite built without FTS5 support), the pipeline falls back to vector-only search without error.

## Agent Teams

Causantic supports Claude Code's multi-agent team sessions, where a lead agent coordinates multiple teammates via `TeamCreate`, `Task` (with `team_name`), and `SendMessage`.

### Ingestion

During ingestion, Causantic detects team sessions by scanning for team-related tool calls in the main session. It then:

1. **Partitions sub-agents**: Separates team members (identified by `team_name` in Task calls) from regular sub-agents
2. **Filters dead-end files**: Race conditions create stub files when multiple messages arrive simultaneously; these are detected (no assistant messages + ≤2 lines) and skipped
3. **Groups teammate files**: A single teammate may produce multiple files (one per incoming message); these are grouped by resolved human name
4. **Resolves names**: Hex agent IDs are mapped to human-readable names using Task `name` param > Task result > SendMessage metadata > `<teammate-message>` XML
5. **Creates team edges**: `team-spawn` (lead→teammate), `team-report` (teammate→lead), `peer-message` (teammate→teammate)

Regular sub-agents continue through the existing brief/debrief pipeline.

### Retrieval

The optional `agent` parameter on `search`, `recall`, `predict`, and `reconstruct` filters results to a specific agent (e.g., `agent: "researcher"`). For chain-walking tools (`recall`/`predict`), the filter applies to seed selection only — once a chain starts, it follows edges freely across agent boundaries.

Output includes agent attribution: `| Agent: researcher` in chunk headers, and `--- Agent: researcher ---` boundary markers in reconstruction.

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
