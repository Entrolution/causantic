# Configuration Reference

Complete reference for all Causantic configuration options.

## Configuration File

Causantic uses JSON configuration files. Create `causantic.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json"
}
```

## Decay Settings

### `decay.backward`

Controls decay for backward (historical) edges.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"linear"` \| `"exponential"` \| `"delayed-linear"` | `"linear"` | Decay curve type |
| `diesAtHops` | `integer` | `10` | Hops at which weight reaches zero (1-100) |
| `holdHops` | `integer` | `0` | Hops at full weight before decay (0-50) |

**Research finding**: Linear decay at 10 hops achieves MRR=0.688 (1.35× vs exponential decay).

### `decay.forward`

Controls decay for forward (predictive) edges.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"linear"` \| `"exponential"` \| `"delayed-linear"` | `"delayed-linear"` | Decay curve type |
| `diesAtHops` | `integer` | `20` | Hops at which weight reaches zero (1-100) |
| `holdHops` | `integer` | `5` | Hops at full weight before decay (0-50) |

**Research finding**: Delayed linear (5-hop hold, dies at 20) achieves MRR=0.849 (3.71× vs exponential decay).

## Clustering Settings

### `clustering`

Controls HDBSCAN clustering behavior.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `threshold` | `number` | `0.09` | Angular distance for cluster assignment (0.01-0.5) |
| `minClusterSize` | `integer` | `4` | Minimum points to form a cluster (2-100) |

**Research finding**: Threshold 0.09 achieves F1=0.940 (100% precision, 88.7% recall) on same-cluster pair prediction.

## Traversal Settings

### `traversal`

Controls graph traversal behavior.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxDepth` | `integer` | `20` | Maximum traversal depth from seeds (1-50) |
| `minWeight` | `number` | `0.01` | Minimum edge weight to continue (0-1) |

**Research finding**: maxDepth=20 matches forward decay (dies at 20 hops), achieving 3.88x augmentation over vector-only search.

## Token Settings

### `tokens`

Controls output token budgets.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `claudeMdBudget` | `integer` | `500` | Tokens for CLAUDE.md memory section (100-10000) |
| `mcpMaxResponse` | `integer` | `2000` | Maximum tokens in MCP responses (500-50000) |

## Hybrid Search Settings

### `hybridSearch`

Controls the hybrid BM25 + vector search pipeline. These settings are internal defaults and not currently exposed in `causantic.config.json` — they are configured programmatically via `MemoryConfig`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `rrfK` | `integer` | `60` | RRF constant. Higher values reduce the impact of high-ranked items |
| `vectorWeight` | `number` | `1.0` | Weight for vector search results in RRF fusion |
| `keywordWeight` | `number` | `1.0` | Weight for keyword search results in RRF fusion |
| `keywordSearchLimit` | `integer` | `20` | Maximum keyword results before fusion |

### `clusterExpansion`

Controls cluster-guided expansion during retrieval.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxClusters` | `integer` | `3` | Maximum clusters to expand from per query |
| `maxSiblings` | `integer` | `5` | Maximum sibling chunks added per cluster |
| `boostFactor` | `number` | `0.3` | Score multiplier for cluster siblings (0-1) |

## Storage Settings

### `storage`

Controls data storage locations.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `dbPath` | `string` | `"~/.causantic/memory.db"` | SQLite database path |
| `vectorPath` | `string` | `"~/.causantic/vectors"` | LanceDB vector store directory |

Paths starting with `~` expand to the user's home directory.

## LLM Settings

### `llm`

Controls optional LLM features.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `clusterRefreshModel` | `string` | `"claude-3-haiku-20240307"` | Model for cluster descriptions |
| `refreshRateLimitPerMin` | `integer` | `30` | Rate limit for LLM calls (1-1000) |

**Note**: LLM features are optional. Causantic works without an Anthropic API key.

## Environment Variables

All settings can be overridden via environment variables:

| Setting | Environment Variable |
|---------|---------------------|
| `decay.backward.type` | `CAUSANTIC_DECAY_BACKWARD_TYPE` |
| `decay.backward.diesAtHops` | `CAUSANTIC_DECAY_BACKWARD_DIES_AT_HOPS` |
| `decay.backward.holdHops` | `CAUSANTIC_DECAY_BACKWARD_HOLD_HOPS` |
| `decay.forward.type` | `CAUSANTIC_DECAY_FORWARD_TYPE` |
| `decay.forward.diesAtHops` | `CAUSANTIC_DECAY_FORWARD_DIES_AT_HOPS` |
| `decay.forward.holdHops` | `CAUSANTIC_DECAY_FORWARD_HOLD_HOPS` |
| `clustering.threshold` | `CAUSANTIC_CLUSTERING_THRESHOLD` |
| `clustering.minClusterSize` | `CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE` |
| `traversal.maxDepth` | `CAUSANTIC_TRAVERSAL_MAX_DEPTH` |
| `traversal.minWeight` | `CAUSANTIC_TRAVERSAL_MIN_WEIGHT` |
| `tokens.claudeMdBudget` | `CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET` |
| `tokens.mcpMaxResponse` | `CAUSANTIC_TOKENS_MCP_MAX_RESPONSE` |
| `storage.dbPath` | `CAUSANTIC_STORAGE_DB_PATH` |
| `storage.vectorPath` | `CAUSANTIC_STORAGE_VECTOR_PATH` |
| `llm.clusterRefreshModel` | `CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL` |
| `llm.refreshRateLimitPerMin` | `CAUSANTIC_LLM_REFRESH_RATE_LIMIT` |

## Example Configurations

### Minimal

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json"
}
```

Uses all defaults.

### Long-Range Memory

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "decay": {
    "backward": {
      "type": "delayed-linear",
      "holdHops": 3,
      "diesAtHops": 20
    }
  }
}
```

Extends backward edge lifetime for better long-range recall.

### Large Context Budget

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "tokens": {
    "claudeMdBudget": 1000,
    "mcpMaxResponse": 5000
  }
}
```

Increases token budgets for richer context.
