# Maintenance Guide

This guide covers maintaining your Causantic installation for optimal performance.

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

Re-runs HDBSCAN clustering on all embeddings.

```bash
npx causantic maintenance run update-clusters
```

**Frequency**: Daily

**What it does**:
- Recalculates cluster assignments
- Identifies new topic groups
- Updates cluster centroids

### prune-graph

Removes dead edges and orphaned nodes.

```bash
npx causantic maintenance run prune-graph
```

**Frequency**: Daily

**What it does**:
- Removes edges with zero weight (decayed fully)
- Cleans up orphaned chunks
- Optimizes graph structure

### refresh-labels

Updates cluster descriptions using Haiku.

```bash
npx causantic maintenance run refresh-labels
```

**Frequency**: Weekly (optional)

**What it does**:
- Generates human-readable cluster descriptions
- Requires Anthropic API key
- Improves memory summaries in CLAUDE.md

**Note**: This task is optional. Causantic works without cluster descriptions.

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

Uses cron-style scheduling:
- `scan-projects`: Every hour
- `update-clusters`: Daily at 2am
- `prune-graph`: Daily at 3am
- `refresh-labels`: Sundays at 4am

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
