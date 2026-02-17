# Configuration

Causantic can be configured through multiple sources, applied in this priority order:

1. **CLI flags** (highest priority)
2. **Environment variables** (`CAUSANTIC_*`)
3. **Project config** (`./causantic.config.json`)
4. **User config** (`~/.causantic/config.json`)
5. **Built-in defaults** (lowest priority)

## Configuration File

Create `causantic.config.json` in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/Entrolution/causantic/main/config.schema.json",
  "clustering": {
    "threshold": 0.1,
    "minClusterSize": 4
  },
  "vectors": {
    "ttlDays": 90
  }
}
```

The `$schema` property enables IDE autocomplete and validation.

## Environment Variables

All settings can be overridden via environment variables:

```bash
# Clustering
export CAUSANTIC_CLUSTERING_THRESHOLD=0.10
export CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE=4

# Vector lifecycle
export CAUSANTIC_VECTORS_TTL_DAYS=90
export CAUSANTIC_VECTORS_MAX_COUNT=0

# Storage paths
export CAUSANTIC_STORAGE_DB_PATH=~/.causantic/memory.db
export CAUSANTIC_STORAGE_VECTOR_PATH=~/.causantic/vectors
```

## Key Settings

### Vector Lifecycle

Control how long vectors are kept:

| Setting            | Default | Description                                |
| ------------------ | ------- | ------------------------------------------ |
| `vectors.ttlDays`  | `90`    | Days since last access before expiry       |
| `vectors.maxCount` | `0`     | Max vectors (0 = unlimited, FIFO eviction) |

### Clustering

Control HDBSCAN clustering behavior:

| Setting                     | Default | Description                             |
| --------------------------- | ------- | --------------------------------------- |
| `clustering.threshold`      | `0.10`  | Angular distance for cluster assignment |
| `clustering.minClusterSize` | `4`     | Minimum points per cluster              |

### Token Budgets

Control output sizes:

| Setting                 | Default | Description                         |
| ----------------------- | ------- | ----------------------------------- |
| `tokens.claudeMdBudget` | `500`   | Tokens for CLAUDE.md memory section |
| `tokens.mcpMaxResponse` | `2000`  | Max tokens in MCP responses         |

## More Settings

The settings above are the most commonly tuned. Additional config sections include:

- **Retrieval** — MMR diversity lambda for search result reranking
- **Traversal** — graph traversal depth and weight thresholds
- **Encryption** — database encryption at rest (ChaCha20 or SQLCipher)
- **Embedding** — device selection for local embedding inference
- **Maintenance** — reclustering schedule

See the [Configuration Reference](../reference/configuration.md) for the complete list of all options, defaults, and environment variable mappings.

## Validate Configuration

Check your configuration for errors:

```bash
npx causantic config validate
```

## See Also

- [Configuration Reference](../reference/configuration.md) - Complete option list with defaults and env vars
- [How It Works](../guides/how-it-works.md) - Understand decay and clustering
