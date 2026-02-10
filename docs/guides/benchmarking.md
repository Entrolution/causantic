# Benchmarking Your Collection

Run benchmarks against your own data to see how well the memory system is working.

## Quick Start

```bash
# Quick health check (~1 second)
npx causantic benchmark-collection --quick

# Standard benchmark (~30 seconds)
npx causantic benchmark-collection

# Full benchmark (~2-5 minutes)
npx causantic benchmark-collection --full
```

## What Gets Measured

### Collection Health (always runs)

- Collection size and structure (chunks, sessions, projects)
- Graph connectivity and edge density
- Cluster coverage and quality
- Per-project breakdown

### Retrieval Quality (standard + full)

- Can the system find related chunks? (Adjacent Recall)
- Can it bridge across sessions? (Cross-Session Bridging)
- Does project filtering work? (Precision@K)
- How much of the returned context is useful? (Token Efficiency)

### Graph Value (full only)

- What does the knowledge graph add vs pure vector search?
- Which edge types are most valuable?
- How much "lift" does graph traversal provide?

### Latency (full only)

- How fast are queries across different retrieval modes?
- Are there performance bottlenecks?

## Understanding Your Score

The overall score (0-100) is a weighted composite:

| Category | Weight | What it means |
|----------|--------|---------------|
| Health | 20% | Collection structure and organization |
| Retrieval | 35% | Can the system find the right context? |
| Graph Value | 30% | Does the knowledge graph improve results? |
| Latency | 15% | Is query performance acceptable? |

Only scored categories contribute; weights renormalize. A `--quick` run scores health only.

**Score ranges:**

- **80-100**: Excellent — memory system is working very well
- **60-79**: Good — working well, tuning recommendations may help
- **40-59**: Fair — some areas need attention (check recommendations)
- **0-39**: Needs work — follow tuning recommendations and re-ingest

## Acting on Results

### Tuning Recommendations

The report includes specific recommendations with config changes:

```json
// causantic.config.json
{
  "clustering": { "threshold": 0.12 },
  "traversal": { "maxDepth": 25 }
}
```

After making changes, re-run the benchmark to measure improvement:

```bash
npx causantic benchmark-collection --seed 42
```

Using the same `--seed` ensures comparable results.

### Common Scenarios

**Low cluster coverage (<70%)**

- Lower `clustering.threshold` (default: 0.09, try 0.12)
- Lower `clustering.minClusterSize` (default: 4, try 3)
- Then run `npx causantic cluster --refresh`

**Low graph value (augmentation <1.5x)**

- Increase `traversal.maxDepth` (default: 20, try 25)
- Ensure sessions have been re-ingested with latest parser
- Check edge type distribution — missing types mean missing connections

**High latency (p95 >200ms)**

- Reduce `traversal.maxDepth` (try 15)
- Reduce cluster expansion: `clusterExpansion.maxSiblings: 3`
- For large collections: set `vectors.ttlDays: 60` to prune old vectors

**High orphan rate (>20%)**

- Re-ingest: `npx causantic ingest --reprocess`
- Check that sessions have enough turns for edge extraction

## Tracking Progress

Each run is stored automatically. View trends:

```bash
npx causantic benchmark-collection --history
```

This shows how your score has changed over time, helping you verify that config changes are having the intended effect.

## Reproducibility

Use `--seed` for deterministic sampling:

```bash
npx causantic benchmark-collection --seed 42
```

The same seed produces identical query samples, making before/after comparisons meaningful.

## Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--quick` | Health only | - |
| `--standard` | Health + retrieval | (default) |
| `--full` | All categories | - |
| `--categories` | Comma-separated list | (from profile) |
| `--sample-size` | Queries to sample | 50 |
| `--seed` | Random seed | (random) |
| `--project` | Limit to one project | (all) |
| `--output` | Report directory | `./causantic-benchmark/` |
| `--json` | JSON output only | false |
| `--no-tuning` | Skip recommendations | false |
| `--history` | Show past trends | false |
