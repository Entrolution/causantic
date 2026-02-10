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
  "decay": {
    "backward": {
      "type": "linear",
      "diesAtHops": 10
    },
    "forward": {
      "type": "delayed-linear",
      "holdHops": 5,
      "diesAtHops": 20
    }
  },
  "clustering": {
    "threshold": 0.09,
    "minClusterSize": 4
  }
}
```

The `$schema` property enables IDE autocomplete and validation.

## Environment Variables

All settings can be overridden via environment variables:

```bash
# Decay settings
export CAUSANTIC_DECAY_BACKWARD_TYPE=linear
export CAUSANTIC_DECAY_BACKWARD_DIES_AT_HOPS=10
export CAUSANTIC_DECAY_FORWARD_TYPE=delayed-linear
export CAUSANTIC_DECAY_FORWARD_HOLD_HOPS=5
export CAUSANTIC_DECAY_FORWARD_DIES_AT_HOPS=20

# Clustering
export CAUSANTIC_CLUSTERING_THRESHOLD=0.09
export CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE=4

# Storage paths
export CAUSANTIC_STORAGE_DB_PATH=~/.causantic/memory.db
export CAUSANTIC_STORAGE_VECTOR_PATH=~/.causantic/vectors
```

## Key Settings

### Decay Curves

Control how edge weights decay with logical distance:

| Setting | Default | Description |
|---------|---------|-------------|
| `decay.backward.type` | `linear` | Curve type for historical edges |
| `decay.backward.diesAtHops` | `10` | Hops at which weight reaches zero |
| `decay.forward.type` | `delayed-linear` | Curve type for predictive edges |
| `decay.forward.holdHops` | `5` | Hops at full weight before decay |
| `decay.forward.diesAtHops` | `20` | Total hops to zero |

### Clustering

Control HDBSCAN clustering behavior:

| Setting | Default | Description |
|---------|---------|-------------|
| `clustering.threshold` | `0.09` | Angular distance for cluster assignment |
| `clustering.minClusterSize` | `4` | Minimum points per cluster |

### Token Budgets

Control output sizes:

| Setting | Default | Description |
|---------|---------|-------------|
| `tokens.claudeMdBudget` | `500` | Tokens for CLAUDE.md memory section |
| `tokens.mcpMaxResponse` | `2000` | Max tokens in MCP responses |

## Validate Configuration

Check your configuration for errors:

```bash
npx causantic validate-config
```

## See Also

- [Configuration Reference](../reference/configuration.md) - Complete option list
- [How It Works](../guides/how-it-works.md) - Understand decay and clustering
