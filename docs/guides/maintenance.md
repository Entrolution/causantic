# Maintenance Guide

This guide covers maintaining your Causantic installation for optimal performance.

## Chunk Lifecycle

Chunks follow a simple lifecycle:

1. **Active**: Chunk has edges and is searchable via vector, keyword, and graph queries.
2. **Expired**: After the TTL period (default 90 days since last access), the chunk and its vector are permanently deleted. FK CASCADE removes associated edges and cluster assignments automatically.

If a FIFO cap is configured (`vectors.maxCount`), the oldest vectors (by last access time) are evicted when the collection exceeds the limit.

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

### cleanup-vectors

Removes expired vectors and chunks, and enforces the FIFO cap.

```bash
npx causantic maintenance run cleanup-vectors
```

**Frequency**: Daily (1 hour after `update-clusters`)

**What it does**:

- Finds vectors not accessed within the TTL period (default 90 days)
- Deletes expired chunks (FK CASCADE removes edges and cluster assignments)
- Deletes expired vectors
- If `vectors.maxCount` is configured, evicts the oldest vectors to stay under the limit
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
npx causantic maintenance run cleanup-vectors

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
- `cleanup-vectors`: Daily at 3am
- `vacuum`: Sundays at 5am

### Session-Start Stale Checks

When a new Claude Code session starts, the session-start hook automatically checks if `update-clusters` hasn't run in the last 24 hours. If stale, it runs in the background.

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

Cleanup schedule adjusts automatically (1h after the cluster hour).

### Vector TTL

The TTL for vectors (time since last access before deletion):

```json
{
  "vectors": {
    "ttlDays": 90,
    "maxCount": 0
  }
}
```

Set `maxCount` to a positive value to enable FIFO eviction (e.g., `50000`). Default `0` means unlimited.

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

1. Run update-clusters to optimize clustering
2. Check for very large clusters (may need threshold adjustment)
3. Run vacuum to optimize database

### High Memory Usage

If memory usage is high:

1. Run vacuum to optimize database
2. Configure `vectors.maxCount` to cap collection size
3. Lower `vectors.ttlDays` to expire old vectors sooner

### Missing Context

If expected context isn't being recalled:

1. Verify session was ingested: `npx causantic list-sessions`
2. Check chunk exists: `npx causantic search "your query"`
3. Adjust clustering threshold if topics aren't grouping correctly
