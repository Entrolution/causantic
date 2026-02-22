# Chain Walking Algorithm Reference

Causantic uses a chain-walking algorithm to reconstruct episodic narratives from the causal memory graph.

## Overview

The causal graph is a **sequential linked list** with branch points at sub-agent forks, team edges, and cross-session links. The chain walker uses **multi-path DFS with backtracking** to explore all reachable paths from seed chunks, emitting each as a candidate chain. `selectBestChain()` picks the winner by highest median per-node cosine similarity.

| Direction    | Edge following                            | Use case                            |
| ------------ | ----------------------------------------- | ----------------------------------- |
| **Backward** | Follow edges where target = current chunk | `recall` — "how did we solve this?" |
| **Forward**  | Follow edges where source = current chunk | `predict` — "what comes next?"      |

## Core Algorithm

```typescript
function walkChains(seedIds: string[], options: ChainWalkerOptions): Chain[];
```

### Pseudocode

```
function walkChains(seedIds, options):
    allCandidates = []

    for each seed in seedIds:                   // Per-seed independence
        candidates = walkAllPaths(seed, options)
        allCandidates.append(...candidates)

    return allCandidates

function walkAllPaths(seedId, options):
    candidates = []
    scoreCache = Map()
    expansions = 0
    pathVisited = Set()                         // Per-path, not global
    pathState = { chunkIds: [], scores: [], tokens: 0 }

    // Initialize with seed
    pathVisited.add(seedId)
    pushToPath(seedId)

    dfs(seedId, depth=1, consecutiveSkips=0)
    return candidates

function dfs(currentId, depth, consecutiveSkips):
    if ++expansions > maxExpansions: return
    if candidates.length >= maxCandidates: return

    edges = getEdges(currentId, direction)
    unvisited = edges.filter(e => !pathVisited.has(e.nextId))

    // Terminal: dead end or depth limit — emit candidate
    if unvisited is empty OR depth >= maxDepth:
        emit(currentPath)
        return

    for each edge in unvisited:
        chunk = getChunk(edge.nextId)
        pathVisited.add(edge.nextId)

        // Agent filter: skip but traverse
        if agentFilter and chunk.agentId != agentFilter:
            if consecutiveSkips + 1 <= maxSkippedConsecutive:
                dfs(edge.nextId, depth + 1, consecutiveSkips + 1)
            pathVisited.delete(edge.nextId)
            continue

        score = scoreNode(edge.nextId)          // Memoized
        if tokens + chunk.tokens > tokenBudget:
            emit(currentPath)                   // Budget hit — emit, don't extend
            pathVisited.delete(edge.nextId)
            continue

        push(edge.nextId, score, chunk.tokens)  // Extend path
        dfs(edge.nextId, depth + 1, 0)          // Reset skip counter
        pop()                                   // Backtrack
        pathVisited.delete(edge.nextId)
```

### Chain Selection

```
function selectBestChain(chains):
    qualifying = chains.filter(c => c.length >= 2)
    if qualifying is empty: return null

    // Median per-node similarity — robust to outliers on short chains
    return qualifying.maxBy(c => c.medianScore)
```

## Key Design Decisions

### Multi-path DFS vs greedy single-path

Prior to v0.8.0, the walker used greedy single-path traversal: `pickBestEdge()` selected ONE edge per node (highest `initialWeight`), discarding all alternatives. This worked for linear chains (out-degree 1) but missed alternative paths at branching points (agent transitions, team edges, cross-session links).

Multi-path DFS explores all branches and emits each terminal path as a candidate. `selectBestChain()` gets a proper candidate set. For linear chains, behavior is identical — exactly 1 candidate per seed.

### Per-seed independence

Each seed explores independently with its own per-path visited set. No global visited set across seeds. This allows different seeds on the same chain to both produce candidates through shared nodes. `selectBestChain()` picks the single best chain regardless of which seed produced it.

### Mutable backtracking state

Path state (`chunkIds`, `chunks`, `nodeScores`, token count) uses push/pop with backtracking rather than array spread. This avoids O(depth) allocation per step. `pathVisited` uses `.add()` on entry and `.delete()` on backtracking return.

### Agent filter scoping

When `agentFilter` is set and a non-matching chunk is encountered, the chunk is skipped (not added to output) but its edges are explored. `consecutiveSkips` is passed as a parameter to recursion — each recursive frame gets its own count, reset to 0 when a matching chunk is found. This prevents cross-frame interference during backtracking.

## Pipeline Integration

The chain walker is part of the episodic retrieval pipeline:

```
Query
  │
  ├─ 1. Embed query
  ├─ 2. Vector search + keyword search (parallel)
  ├─ 3. RRF fusion + cluster expansion → top-5 seeds
  │
  ├─ 4. walkChains(seedIds, { direction, tokenBudget, queryEmbedding })
  │     ├─ For each seed, DFS with backtracking explores all paths
  │     ├─ Emit candidate at: dead end, depth limit, or token budget
  │     └─ Per-path visited set prevents cycles within a path
  │
  ├─ 5. selectBestChain(candidates) → highest median per-node similarity with ≥ 2 chunks
  │
  ├─ 6. If chain found → reverse for chronological output (recall only)
  └─ 7. Else → fall back to search-style ranked results
```

## Edge Structure

Edges are stored as single `forward` rows:

| Field             | Value                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `edge_type`       | Always `'forward'`                                                                                        |
| `reference_type`  | `'within-chain'`, `'cross-session'`, `'brief'`, `'debrief'`, `'team-spawn'`, `'team-report'`, `'peer-message'` |
| `source_chunk_id` | Earlier chunk                                                                                             |
| `target_chunk_id` | Later chunk                                                                                               |
| `initial_weight`  | Varies by type: 1.0 (`within-chain`), 0.9 (`brief`/`debrief`/`team-spawn`/`team-report`), 0.85 (`peer-message`), 0.7 (`cross-session`) |

Direction is inferred at query time:

- **Forward edges**: `source_chunk_id = chunkId AND edge_type = 'forward'`
- **Backward edges**: `target_chunk_id = chunkId AND edge_type = 'forward'`

## Chain Scoring

Each node in a chain is scored by cosine similarity to the query:

```
nodeScore = 1 - angularDistance(queryEmbedding, chunkEmbedding)
```

Chain selection uses the **median** per-node score:

```
chain.nodeScores = [nodeScore for each node]
chain.medianScore = median(chain.nodeScores)
```

Median is robust to bridge nodes (semantic novelty) in short chains. A 3-node chain with scores `[0.85, 0.30, 0.82]` gets median `0.82` instead of mean `0.66`, correctly recognizing that most of the chain is highly relevant despite one bridge node.

## Configuration

### ChainWalkerOptions

```typescript
interface ChainWalkerOptions {
  direction: 'forward' | 'backward';
  tokenBudget: number;          // Max tokens per path
  queryEmbedding: number[];     // For per-node scoring
  maxDepth?: number;            // Safety cap (default: 50)
  agentFilter?: string;         // Skip non-matching chunks
  maxSkippedConsecutive?: number; // Abandon branch after N skips (default: 5)
  maxCandidatesPerSeed?: number; // Cap on emitted chains per seed (default: 10)
  maxExpansionsPerSeed?: number; // Cap on DFS recursive calls per seed (default: 200)
}
```

### Memory Config

```json
{
  "traversal": {
    "maxDepth": 50
  }
}
```

`maxDepth` limits the maximum chain depth. For most collections, the token budget is the effective limit. `maxExpansionsPerSeed` bounds DFS cost on rare dense subgraphs.

## Performance Characteristics

| Aspect           | Behavior                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| Time complexity  | O(S × E) where S = seeds (5), E = expansions per seed (≤200)                  |
| Space complexity | O(D) where D = max path depth (mutable backtracking state)                     |
| Edge lookups     | O(1) per hop via indexed queries                                               |
| Scoring          | O(1) per unique node (memoized — in-memory vector Map lookup + dot product)    |

### Bounding DFS Cost

Two independent limits prevent runaway exploration:

1. **`maxExpansionsPerSeed = 200`** — pre-order counter incremented at each DFS recursive call. Aborts entire seed's DFS when reached.
2. **`maxCandidatesPerSeed = 10`** — cap on emitted chains per seed. Early-exit once enough candidates are collected.

With typical out-degree 1 (linear chains), a seed's DFS visits ~50 nodes (1 path). At branching points (out-degree 2-3), total expansions are ~60-100. The 200-expansion budget is generous for typical graphs and protective against rare dense subgraphs.

### Score Memoization

`Map<string, number>` cache for `scoreNode()` results per seed walk. A node at depth 1 that branches to 3 paths would otherwise be scored 3 times. Each node is scored at most once per seed.

## Comparison to Previous Algorithms

### v0.2: Sum-Product Traversal

- Explored **all paths** from seeds, accumulating weights multiplicatively
- Handled cycles via geometric attenuation (weight-based pruning)
- Required hop-based decay curves and `minWeight` threshold
- O(E × D) complexity where E = edges explored

### v0.3–v0.7: Greedy Single-Path

- Followed **one edge per node** (highest `initialWeight`), building a single chain per seed
- Handled cycles via global visited set (O(1) lookup)
- No decay curves needed — scoring uses direct cosine similarity to query
- O(S × L) complexity — fast but missed alternative paths at branching points

### v0.8: Multi-Path DFS

- Explores **all paths** from each seed via DFS with backtracking
- Handles cycles via per-path visited set (add on entry, delete on backtrack)
- Emits candidate at every terminal condition (dead end, depth limit, token budget)
- Bounded by `maxExpansionsPerSeed` (200) and `maxCandidatesPerSeed` (10)
- For linear chains (out-degree 1), behavior identical to v0.3–v0.7

## Related

- [Storage API](./storage-api.md) - Edge and chunk storage
- [Configuration](./configuration.md) - Chain walking settings
