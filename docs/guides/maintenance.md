# Maintenance Guide

This guide covers maintaining your Causantic installation for optimal performance.

## Chunk Lifecycle

Chunks follow a defined lifecycle through the system:

1. **Active**: Chunk is on the causal graph (has edges) and searchable via vector, keyword, and graph queries.
2. **Orphaned**: Chunk loses all edges after pruning. Its vector is marked with an `orphaned_at` timestamp. The chunk remains searchable via vector and keyword queries but is no longer reachable via graph traversal.
3. **Expired**: After the TTL period (default 90 days), the chunk and its vector are permanently deleted. Empty clusters left behind are cleaned up automatically.

This design ensures chunks remain discoverable through non-graph search paths even after they fall off the causal graph.

## Maintenance Tasks

### scan-projects

Discovers new sessions and ingests changes.

```bash
npx causantic maintenance run scan-projects
```

**Frequency**: Hourly (or on-demand)

**What it does**:
- Scans `~/.claude/projects/` for new sessions
- Ingests new content into the memory store
- Updates edge relationships

### update-clusters

Re-runs HDBSCAN clustering on all embeddings and refreshes cluster labels.

```bash
npx causantic maintenance run update-clusters
```

**Frequency**: Daily (configurable via `maintenance.clusterHour`)

**What it does**:
- Full rebuild of cluster assignments using HDBSCAN
- Identifies new topic groups and updates centroids
- Refreshes cluster labels via Haiku (if Anthropic API key is configured)

**Note**: Label refresh requires an Anthropic API key but is not fatal if unavailable. Causantic works without cluster descriptions.

### prune-graph

Removes dead edges from the causal graph.

```bash
npx causantic maintenance run prune-graph
```

**Frequency**: Daily (1 hour after `update-clusters`)

**What it does**:
- Calculates decay weights for all edges
- Removes edges with zero weight (fully decayed)
- Marks chunks that lose all edges as orphaned (starts TTL countdown)

The pruner only manages edges — it never deletes chunks directly. Chunks that fall off the graph remain searchable via vector and keyword queries until their TTL expires.

### cleanup-vectors

Removes expired orphaned vectors and their chunks.

```bash
npx causantic maintenance run cleanup-vectors
```

**Frequency**: Daily (1.5 hours after `update-clusters`)

**What it does**:
- Finds vectors marked as orphaned longer than the TTL period (default 90 days)
- Deletes the expired chunks (FK cascades remove cluster assignments and edges)
- Deletes the expired vectors
- Removes empty clusters left behind after chunk deletion

### vacuum

Optimizes the SQLite database.

```bash
npx causantic maintenance run vacuum
```

**Frequency**: Weekly (Sundays at 5am)

**What it does**:
- Runs SQLite VACUUM to reclaim disk space
- Rebuilds internal data structures for better query performance

## Running Maintenance

### On-Demand

```bash
# Run a specific task
npx causantic maintenance run prune-graph

# Run all tasks
npx causantic maintenance run all
```

### Check Status

```bash
npx causantic maintenance status
```

Shows last run times and next scheduled runs.

### Daemon Mode

Run maintenance as a background service:

```bash
npx causantic maintenance daemon
```

Uses cron-style scheduling (assuming default `clusterHour` of 2):
- `scan-projects`: Every hour
- `update-clusters`: Daily at 2am
- `prune-graph`: Daily at 3am
- `cleanup-vectors`: Daily at 3:30am
- `vacuum`: Sundays at 5am

### Session-Start Stale Checks

When a new Claude Code session starts, the session-start hook automatically checks if `prune-graph` or `update-clusters` haven't run in the last 24 hours. If stale, they run in the background. This covers cases where scheduled cron times were missed (e.g. laptop was asleep overnight).

## Configuration

### Cluster Schedule

The hour at which reclustering runs is configurable:

```json
{
  "maintenance": {
    "clusterHour": 2
  }
}
```

Or via environment variable:

```bash
export CAUSANTIC_MAINTENANCE_CLUSTER_HOUR=4
```

Prune and cleanup schedules adjust automatically (1h and 1.5h after the cluster hour respectively).

### Vector TTL

The TTL for orphaned vectors (time between losing all edges and being deleted):

```json
{
  "vectors": {
    "ttlDays": 90
  }
}
```

## Storage Management

### Check Storage Size

```bash
du -sh ~/.causantic/
```

### Database Optimization

```bash
npx causantic maintenance run vacuum
```

Runs SQLite VACUUM to reclaim space.

### Export/Backup

```bash
# Export memory to JSON
npx causantic export --output backup.causantic.json

# Import from backup
npx causantic import backup.causantic.json
```

## Monitoring

### Health Check

```bash
npx causantic health
```

Checks:
- Database connectivity
- Vector store status
- Cluster count
- Edge statistics

### Statistics

```bash
npx causantic stats
```

Shows:
- Total chunks
- Total edges (by type)
- Cluster count
- Storage size

## Troubleshooting

### Slow Queries

If queries are slow:

1. Run prune-graph to remove dead edges
2. Run update-clusters to optimize clustering
3. Check for very large clusters (may need threshold adjustment)

### High Memory Usage

If memory usage is high:

1. Run vacuum to optimize database
2. Consider adjusting `diesAtHops` to prune edges faster
3. Archive old sessions if needed

### Missing Context

If expected context isn't being recalled:

1. Verify session was ingested: `npx causantic list-sessions`
2. Check chunk exists: `npx causantic search "your query"`
3. Adjust clustering threshold if topics aren't grouping correctly
