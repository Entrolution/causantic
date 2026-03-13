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

### Semantic Index

Raw chunks vary widely in size (64–4096 tokens). Long, keyword-rich chunks dominate cosine similarity scores, which the system compensates for with length penalties and MMR budget caps. The **semantic index** introduces a normalised intermediate layer: each chunk gets an **index entry** — an LLM-compressed natural-language description (~100–150 tokens) that captures the chunk's key decisions, technologies, and outcomes. These fixed-size descriptions are what gets searched, with pointers back to the actual chunks.

```
┌────────────────────────────────────────────────────────┐
│                  RETRIEVAL LAYERS                       │
│                                                        │
│  Query ─► Search Index Entries ─► Dereference to Chunks│
│                  │                        │            │
│       (~130 tok, normalised)     (raw 64-4096 tok)     │
│       (uniform info density)     (full content)        │
└────────────────────────────────────────────────────────┘
```

Each index entry stores:
- **Description**: Natural language (~130 tokens), embedded in a separate vector namespace (`index_vectors`)
- **Metadata columns**: Date, project, agent — stored as structured DB fields, not baked into description text
- **Chunk references**: Links to 1+ chunk IDs via `index_entry_chunks` table
- **Generation method**: `llm` (primary) or `heuristic` (offline fallback)

When index entries exist, retrieval searches descriptions instead of raw chunks. Downstream pipeline (cluster expansion, MMR, budget assembly) still operates on chunk IDs after dereference. When no entries exist, the system falls back to direct chunk search automatically.

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
   ├── Generate chunk embeddings    ─► vectors (LanceDB)
   ├── Generate index entries        ─► index_entries (SQLite)
   ├── Embed index descriptions      ─► index_vectors (LanceDB)
   └── Update clusters
```

### Ingestion with Semantic Index

After chunks are stored and embedded, a non-blocking hook generates index entries:

```
Session JSONL
    │
    ▼
┌─────────────────┐
│ Parse & Chunk    │
│ (ingest-session) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Store chunks     │────►│ Embed chunks     │
│ (chunk-store)    │     │ (vectors table)  │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Index Entry Hook (non-blocking)         │
│                                         │
│  ┌─────────────────┐   ┌─────────────┐ │
│  │ LLM generation  │──►│ Heuristic   │ │
│  │ (Haiku, batched │   │ (fallback)  │ │
│  │  per session)   │   └─────────────┘ │
│  └────────┬────────┘                    │
│           ▼                             │
│  ┌─────────────────┐                    │
│  │ Insert entries   │                    │
│  │ (index_entries + │                    │
│  │  index_entry_    │                    │
│  │  chunks)         │                    │
│  └────────┬────────┘                    │
│           ▼                             │
│  ┌─────────────────┐                    │
│  │ Embed descriptions│                   │
│  │ (index_vectors)  │                    │
│  └──────────────────┘                   │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Create edges     │
│ (causal graph)   │
└─────────────────┘
```

LLM generation batches all chunks from a session into a single Haiku call (~0.05 cents). If the API key is unavailable, the heuristic fallback extracts the first meaningful content lines (~130 tokens). Failures in the hook are logged but never block ingestion.

## Retrieval Process

Causantic has two retrieval modes. Both share the same front end (embed query, parallel search, RRF fusion) but differ in what they search — index entries when available, raw chunks otherwise.

### Search Pipeline (dual path)

The pipeline automatically selects the index-based or chunk-based search path at runtime:

```
                          ┌───────────────┐
                          │  Embed query   │
                          └───────┬───────┘
                                  │
                     ┌────────────┴────────────┐
                     │  Index entries exist?    │
                     └────┬───────────────┬────┘
                     yes  │               │  no
                          ▼               ▼
              ┌───────────────┐  ┌───────────────┐
              │ INDEX PATH    │  │ CHUNK PATH    │
              │               │  │ (fallback)    │
              │ ┌───────────┐ │  │ ┌───────────┐ │
              │ │ Vector    │ │  │ │ Vector    │ │
              │ │ search    │ │  │ │ search    │ │
              │ │ (index_   │ │  │ │ (vectors) │ │
              │ │  vectors) │ │  │ └───────────┘ │
              │ └───────────┘ │  │               │
              │ ┌───────────┐ │  │ ┌───────────┐ │
              │ │ Keyword   │ │  │ │ Keyword   │ │
              │ │ search    │ │  │ │ search    │ │
              │ │ (index_   │ │  │ │ (chunks_  │ │
              │ │ entries_  │ │  │ │  fts)     │ │
              │ │  fts)     │ │  │ └───────────┘ │
              │ └───────────┘ │  │               │
              │       │       │  │       │       │
              │       ▼       │  │       ▼       │
              │ ┌───────────┐ │  │ ┌───────────┐ │
              │ │ RRF on    │ │  │ │ RRF on    │ │
              │ │ index IDs │ │  │ │ chunk IDs │ │
              │ └─────┬─────┘ │  │ └───────────┘ │
              │       │       │  │               │
              │       ▼       │  │               │
              │ ┌───────────┐ │  │               │
              │ │ Dereference│ │  │               │
              │ │ to chunk  │ │  │               │
              │ │ IDs       │ │  │               │
              │ └───────────┘ │  │               │
              └───────┬───────┘  └───────┬───────┘
                      │                  │
                      └────────┬─────────┘
                               │
                               ▼  chunk IDs + scores
                      ┌───────────────┐
                      │ Cluster       │
                      │ expansion     │
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Recency boost │
                      │ + length      │  (length penalty
                      │   penalty     │   disabled on
                      └───────┬───────┘   index path)
                              │
                      ┌───────┴───────┐
                      │ Size filter   │
                      │ (oversized    │
                      │  exclusion)   │
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ MMR reranking │
                      │ (budget-aware)│
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Assemble      │
                      │ within budget │
                      └───────────────┘
```

**Index path**: Vector search targets `index_vectors` (index entry embeddings). Keyword search targets `index_entries_fts` (FTS5 on descriptions). After RRF, a dereference step maps index entry IDs → chunk IDs via the `index_entry_chunks` table. The length penalty is disabled because index entries are normalised — there's no size-driven score distortion to correct for.

**Chunk path** (fallback): The original pipeline — vector search on `vectors`, keyword search on `chunks_fts`, RRF directly on chunk IDs. Active when no index entries exist or when `semanticIndex.useForSearch` is disabled.

Both paths converge at cluster expansion, which always operates on chunk IDs and their chunk-level cluster assignments.

### Entity Boosting

During ingestion, Causantic extracts named entities from chunk content using deterministic regex patterns (no LLM required):

- **People**: `@mentions`, email addresses, "X said"/"with X" patterns
- **Channels**: `#channel` references
- **Meetings**: Keywords like standup, retro, 1:1, sync
- **URLs**: Full URL patterns

Entities are resolved to canonical forms with alias tracking (e.g., `@joel` and `Joel` map to the same entity). At query time, if the search query contains recognisable entity references, matching chunks are injected as an additional RRF source with a 1.5x boost weight. This means searching for "@joel" surfaces all chunks mentioning Joel alongside semantically relevant results, without requiring exact keyword matches in every chunk.

Entity extraction skips code blocks and `[Thinking]` blocks to avoid false positives from speculative content.

### Recall/Predict (episodic)

The `recall` and `predict` tools reconstruct narrative chains:

```
                      ┌───────────────┐
                      │  Embed query   │
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Seed discovery │  (same dual-path
                      │ (search        │   search as above,
                      │  pipeline)     │   top 5 results
                      └───────┬───────┘   become seeds)
                              │
                              ▼  5 seed chunk IDs
                      ┌───────────────┐
                      │ Multi-path    │  DFS with backtracking
                      │ chain walking │  from each seed
                      │               │  (backward=recall,
                      │               │   forward=predict)
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Chain scoring  │  median cosine
                      │ + selection   │  similarity to query
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Budget-aware  │  no partial chunks
                      │ formatting    │
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │ Fallback to   │  if no chain ≥ 2
                      │ search results│  chunks qualifies
                      └───────────────┘
```

1. **Seed discovery**: Uses the full search pipeline (index or chunk path) to find the top 5 seeds
2. **Multi-path chain walking**: For each seed, DFS with backtracking explores all reachable paths (backward for recall, forward for predict). Oversized chunks (larger than the token budget) are traversed through for graph connectivity but excluded from path output and scoring. At branching points (agent transitions, cross-session links), all branches are explored and emitted as candidates
3. **Chain scoring**: Each candidate chain scored by median per-node cosine similarity to the query (oversized chunks excluded from median)
4. **Best chain selection**: Highest median score among candidates with ≥ 2 chunks
5. **Budget-aware formatting**: Iterate through the selected chain, accepting only chunks that fit within the remaining token budget — no partial chunks
6. **Fallback**: If no qualifying chain found, fall back to search-style results

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

MMR is also budget-aware: it tracks remaining token budget during selection and excludes candidates that would exceed it. This prevents large chunks from winning a diversity slot only to be truncated or dropped during final assembly.

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

### Index Entry Clustering

Index entries are also clustered separately (stored in `index_entry_clusters`). Each cluster elects a **representative** — the entry closest to the centroid — providing a browsable "table of contents" of memory topics. Index entry clustering runs during the `update-clusters` maintenance task.

## Deletion and Cleanup

When chunks are deleted (via the `forget` tool or TTL maintenance), index entries are cascaded:

```
forget("auth bug")
    │
    ├── Delete chunks from SQLite
    ├── Delete chunk vectors from LanceDB
    └── Delete index entries for those chunks
        │
        ├── Remove rows from index_entry_chunks
        ├── Find orphaned index entries (no remaining chunk refs)
        ├── Delete orphaned entries from index_entries
        └── Delete orphaned vectors from index_vectors
```

The cascade ensures no dangling index entries accumulate after chunk deletion.

### Backfill Maintenance

The `backfill-index` maintenance task generates index entries for chunks that were ingested before the semantic index was enabled, or where LLM generation failed at ingestion time:

```
backfill-index (runs every maintenance cycle)
    │
    ├── Find unindexed chunk IDs
    ├── Group by session slug
    ├── For each session batch:
    │   ├── Generate entries (LLM primary, heuristic fallback)
    │   ├── Insert into index_entries + index_entry_chunks
    │   └── Embed descriptions into index_vectors
    └── Report indexed/total/remaining counts
```

Controlled by `semanticIndex.batchRefreshLimit` (default: 500 per run).

## Storage

Causantic uses two storage backends:

- **SQLite**: Chunks, edges, clusters, index entries, metadata
- **LanceDB**: Vector embeddings for similarity search (two namespaces: `vectors` for chunks, `index_vectors` for index entries)

Default location: `~/.causantic/`

### Schema Overview

```
┌───────────────────────────────────────────────────┐
│                    SQLite                          │
│                                                   │
│  chunks ──────────── edges                        │
│    │                                              │
│    ├── chunk_clusters ── clusters                  │
│    │                                              │
│    └── index_entry_chunks ── index_entries         │
│                                  │                │
│                    index_entry_clusters            │
│                                                   │
│  chunks_fts (FTS5)    index_entries_fts (FTS5)    │
│  ingestion_checkpoints    embedding_cache          │
│  hdbscan_models                                   │
└───────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────┐
│                   LanceDB                         │
│                                                   │
│  vectors         (chunk embeddings)               │
│  index_vectors   (index entry embeddings)         │
└───────────────────────────────────────────────────┘
```

## See Also

- [Integration](integration.md) - Hooks and MCP setup
- [Configuration](../getting-started/configuration.md) - Tune parameters
- [Research](../research/README.md) - Detailed technical findings
