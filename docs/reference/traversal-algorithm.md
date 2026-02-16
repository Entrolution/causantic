# Chain Walking Algorithm Reference

Causantic uses a chain-walking algorithm to reconstruct episodic narratives from the causal memory graph.

## Overview

The causal graph is a **sequential linked list** with branch points at sub-agent forks. The chain walker follows directed edges to build ordered narrative chains from seed chunks.

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
    chains = []
    visited = Set()
    tokenTally = 0

    for each seed in seedIds:
        chain = []
        current = seed

        while current is not null:
            if current in visited: break  // Cycle handling
            visited.add(current)

            chunk = getChunk(current)
            score = cosineSimilarity(queryEmbedding, chunkEmbedding)
            tokenTally += chunk.approxTokens

            if tokenTally > tokenBudget: break  // Budget exhausted

            chain.append({ chunkId: current, score })

            // Follow directed edges
            if direction == 'backward':
                edges = getBackwardEdges(current)  // target_chunk_id = current
            else:
                edges = getForwardEdges(current)    // source_chunk_id = current

            current = edges[0]?.nextChunkId or null  // Sequential: at most one edge

        if chain.length >= 1:
            chains.append(chain)

    return chains
```

### Chain Selection

```
function selectBestChain(chains):
    qualifying = chains.filter(c => c.length >= 2)
    if qualifying is empty: return null

    // Median per-node similarity — robust to outliers on short chains
    return qualifying.maxBy(c => c.medianScore)
```

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
  │     ├─ Follow directed edges, one chain per seed
  │     ├─ Stop when token tally exceeds budget
  │     └─ Skip revisited nodes (cycle handling)
  │
  ├─ 5. selectBestChain(chains) → highest median per-node similarity with ≥ 2 chunks
  │
  ├─ 6. If chain found → reverse for chronological output (recall only)
  └─ 7. Else → fall back to search-style ranked results
```

## Edge Structure

Edges are stored as single `forward` rows:

| Field             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| `edge_type`       | Always `'forward'`                                             |
| `reference_type`  | `'within-chain'`, `'cross-session'`, `'brief'`, or `'debrief'` |
| `source_chunk_id` | Earlier chunk                                                  |
| `target_chunk_id` | Later chunk                                                    |
| `initial_weight`  | Always `1.0`                                                   |

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
  tokenBudget: number; // Max tokens across all chains
  queryEmbedding: number[]; // For per-node scoring
  maxDepth?: number; // Safety cap (default: from config, typically 50)
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

`maxDepth` is a safety net that limits chain length. For most collections, the token budget is the effective limit.

## Performance Characteristics

| Aspect           | Behavior                                                  |
| ---------------- | --------------------------------------------------------- |
| Time complexity  | O(S × L) where S = seeds (5), L = max chain length        |
| Space complexity | O(V) where V = unique chunks visited                      |
| Edge lookups     | O(1) per hop via indexed queries                          |
| Scoring          | O(1) per node (in-memory vector Map lookup + dot product) |

### Optimizations

1. **Token budget**: Chains stop growing when budget is exhausted
2. **Depth limit**: Safety cap on chain length
3. **Global visited set**: Prevents re-traversal across seeds
4. **Sequential structure**: At most one outgoing edge per direction → no branching search

## Comparison to Previous Algorithm

### Previous: Sum-Product Traversal

- Explored **all paths** from seeds, accumulating weights multiplicatively
- Handled cycles via geometric attenuation (weight-based pruning)
- Required hop-based decay curves and `minWeight` threshold
- O(E × D) complexity where E = edges explored

### Current: Chain Walking

- Follows **sequential links** from seeds, building ordered chains
- Handles cycles via visited set (O(1) lookup)
- No decay curves needed — scoring uses direct cosine similarity to query
- O(S × L) complexity, much faster for the same graph size

## Related

- [Storage API](./storage-api.md) - Edge and chunk storage
- [Configuration](./configuration.md) - Chain walking settings
