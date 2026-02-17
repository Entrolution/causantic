# Configuration Reference

Complete reference for all Causantic configuration options.

## Configuration File

Causantic uses JSON configuration files. Create `causantic.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json"
}
```

## Clustering Settings

### `clustering`

Controls HDBSCAN clustering behavior.

| Property         | Type      | Default | Description                                        |
| ---------------- | --------- | ------- | -------------------------------------------------- |
| `threshold`      | `number`  | `0.10`  | Angular distance for cluster assignment (0.01-0.5) |
| `minClusterSize` | `integer` | `4`     | Minimum points to form a cluster (2-100)           |

**Research finding**: Threshold 0.10 achieves F1=0.940 (100% precision, 88.7% recall) on same-cluster pair prediction.

## Traversal Settings

### `traversal`

Controls chain walking behavior.

| Property   | Type      | Default | Description                               |
| ---------- | --------- | ------- | ----------------------------------------- |
| `maxDepth` | `integer` | `50`    | Safety cap on chain walking depth (1-100) |

`maxDepth` limits the maximum chain length during episodic recall/predict. The token budget is the primary stopping criterion; `maxDepth` is a safety net.

## Token Settings

### `tokens`

Controls output token budgets.

| Property         | Type      | Default | Description                                     |
| ---------------- | --------- | ------- | ----------------------------------------------- |
| `claudeMdBudget` | `integer` | `500`   | Tokens for CLAUDE.md memory section (100-10000) |
| `mcpMaxResponse` | `integer` | `20000` | Maximum tokens in MCP responses (500-50000)     |

## Hybrid Search Settings

### `hybridSearch`

Controls the hybrid BM25 + vector search pipeline. These settings are internal defaults and not currently exposed in `causantic.config.json` — they are configured programmatically via `MemoryConfig`.

| Property             | Type      | Default | Description                                                        |
| -------------------- | --------- | ------- | ------------------------------------------------------------------ |
| `rrfK`               | `integer` | `60`    | RRF constant. Higher values reduce the impact of high-ranked items |
| `vectorWeight`       | `number`  | `1.0`   | Weight for vector search results in RRF fusion                     |
| `keywordWeight`      | `number`  | `1.0`   | Weight for keyword search results in RRF fusion                    |
| `keywordSearchLimit` | `integer` | `20`    | Maximum keyword results before fusion                              |

### `clusterExpansion`

Controls cluster-guided expansion during retrieval. These settings are internal defaults and not currently exposed in `causantic.config.json` — they are configured programmatically via `MemoryConfig`.

| Property      | Type      | Default | Description                                 |
| ------------- | --------- | ------- | ------------------------------------------- |
| `maxClusters` | `integer` | `3`     | Maximum clusters to expand from per query   |
| `maxSiblings` | `integer` | `5`     | Maximum sibling chunks added per cluster    |

## Retrieval Settings

### `retrieval`

Controls the search retrieval pipeline.

| Property    | Type     | Default | Description                                                        |
| ----------- | -------- | ------- | ------------------------------------------------------------------ |
| `mmrLambda` | `number` | `0.7`   | MMR (Maximal Marginal Relevance) lambda parameter (0-1)            |

MMR reranks search results to balance relevance with diversity. After RRF fusion and cluster expansion, candidates are reordered so that semantically redundant chunks yield to novel ones.

- `1.0` = pure relevance (no diversity, same as pre-MMR behaviour)
- `0.7` = default balance (first pick is always top relevance; subsequent picks trade off diminishing relevance for novelty)
- `0.0` = pure diversity (maximally spread results across topics)

MMR applies to both the `search` tool and the seed-finding stage of `recall`/`predict`. It only activates when there are 10+ candidates (below that, diversity is moot).

## Storage Settings

### `storage`

Controls data storage locations.

| Property     | Type     | Default                    | Description                    |
| ------------ | -------- | -------------------------- | ------------------------------ |
| `dbPath`     | `string` | `"~/.causantic/memory.db"` | SQLite database path           |
| `vectorPath` | `string` | `"~/.causantic/vectors"`   | LanceDB vector store directory |

Paths starting with `~` expand to the user's home directory.

### `vectors`

Controls vector storage lifecycle.

| Property   | Type      | Default | Description                                                   |
| ---------- | --------- | ------- | ------------------------------------------------------------- |
| `ttlDays`  | `integer` | `90`    | Days since last access before vector expiry (1-3650)          |
| `maxCount` | `integer` | `0`     | Maximum vectors to keep. 0 = unlimited. Oldest evicted first. |

## Encryption Settings

### `encryption`

Controls database encryption at rest.

| Property    | Type                                  | Default      | Description                                                                                     |
| ----------- | ------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `enabled`   | `boolean`                             | `false`      | Enable database encryption                                                                      |
| `cipher`    | `"chacha20"` \| `"sqlcipher"`         | `"chacha20"` | Encryption cipher. ChaCha20-Poly1305 is 2-3x faster on ARM.                                     |
| `keySource` | `"keychain"` \| `"env"` \| `"prompt"` | `"keychain"` | Where to get encryption key: OS secret store, `CAUSANTIC_DB_KEY` env var, or interactive prompt |
| `auditLog`  | `boolean`                             | `false`      | Log database access attempts to `~/.causantic/audit.log`                                        |

See [Security Guide](../guides/security.md) for encryption setup instructions.

## Embedding Settings

### `embedding`

Controls embedding model inference.

| Property | Type                                                      | Default  | Description                                                                                                          |
| -------- | --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `device` | `"auto"` \| `"coreml"` \| `"cuda"` \| `"cpu"` \| `"wasm"` | `"auto"` | Device for embedding inference. `auto` detects hardware capabilities (CoreML on Apple Silicon, CUDA on NVIDIA GPUs). |

## Maintenance Settings

### `maintenance`

Controls the maintenance schedule.

| Property      | Type      | Default | Description                                                             |
| ------------- | --------- | ------- | ----------------------------------------------------------------------- |
| `clusterHour` | `integer` | `2`     | Hour of day (0-23) to run reclustering. Cleanup tasks run 1-1.5h after. |

## LLM Settings

### `llm`

Controls optional LLM features.

| Property                 | Type      | Default                     | Description                       |
| ------------------------ | --------- | --------------------------- | --------------------------------- |
| `clusterRefreshModel`    | `string`  | `"claude-3-haiku-20240307"` | Model for cluster descriptions    |
| `refreshRateLimitPerMin` | `integer` | `30`                        | Rate limit for LLM calls (1-1000) |

**Note**: LLM features are optional. Causantic works without an Anthropic API key.

## Environment Variables

All settings can be overridden via environment variables:

| Setting                      | Environment Variable                    |
| ---------------------------- | --------------------------------------- |
| `clustering.threshold`       | `CAUSANTIC_CLUSTERING_THRESHOLD`        |
| `clustering.minClusterSize`  | `CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE` |
| `traversal.maxDepth`         | `CAUSANTIC_TRAVERSAL_MAX_DEPTH`         |
| `tokens.claudeMdBudget`      | `CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET`     |
| `tokens.mcpMaxResponse`      | `CAUSANTIC_TOKENS_MCP_MAX_RESPONSE`     |
| `storage.dbPath`             | `CAUSANTIC_STORAGE_DB_PATH`             |
| `storage.vectorPath`         | `CAUSANTIC_STORAGE_VECTOR_PATH`         |
| `vectors.ttlDays`            | `CAUSANTIC_VECTORS_TTL_DAYS`            |
| `vectors.maxCount`           | `CAUSANTIC_VECTORS_MAX_COUNT`           |
| `llm.clusterRefreshModel`    | `CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL`   |
| `llm.refreshRateLimitPerMin` | `CAUSANTIC_LLM_REFRESH_RATE_LIMIT`      |
| `encryption.enabled`         | `CAUSANTIC_ENCRYPTION_ENABLED`          |
| `encryption.cipher`          | `CAUSANTIC_ENCRYPTION_CIPHER`           |
| `encryption.keySource`       | `CAUSANTIC_ENCRYPTION_KEY_SOURCE`       |
| `encryption.auditLog`        | `CAUSANTIC_ENCRYPTION_AUDIT_LOG`        |
| `embedding.device`           | `CAUSANTIC_EMBEDDING_DEVICE`            |
| `maintenance.clusterHour`    | `CAUSANTIC_MAINTENANCE_CLUSTER_HOUR`    |
| `retrieval.mmrLambda`        | `CAUSANTIC_RETRIEVAL_MMR_LAMBDA`        |

## Example Configurations

### Minimal

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json"
}
```

Uses all defaults.

### Deep Chain Walking

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "traversal": {
    "maxDepth": 100
  }
}
```

Increases the chain walking depth limit for collections with very long session histories.

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

### More Diverse Search Results

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "retrieval": {
    "mmrLambda": 0.5
  }
}
```

Lowers the MMR lambda to favour diversity over relevance. Useful when search results are dominated by near-duplicate hits from the same session.

### Encrypted Database

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "encryption": {
    "enabled": true,
    "cipher": "chacha20",
    "keySource": "keychain"
  }
}
```

Enables ChaCha20-Poly1305 encryption with the key stored in the OS keychain.
