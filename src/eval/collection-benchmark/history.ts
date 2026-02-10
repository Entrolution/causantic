/**
 * Historical trending for benchmark runs.
 *
 * Stores benchmark results in SQLite and computes trends between runs.
 */

import { getDb } from '../../storage/db.js';
import type {
  CollectionBenchmarkResult,
  BenchmarkRunSummary,
  TrendReport,
  MetricDelta,
} from './types.js';

/**
 * Ensure the benchmark_runs table exists.
 * Called lazily on first use rather than via schema migration.
 */
function ensureTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      profile TEXT NOT NULL,
      overall_score REAL NOT NULL,
      result_json TEXT NOT NULL,
      config_snapshot TEXT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_timestamp ON benchmark_runs(timestamp)
  `);
}

/**
 * Store a completed benchmark run.
 */
export function storeBenchmarkRun(
  result: CollectionBenchmarkResult,
  configSnapshot?: Record<string, unknown>,
): void {
  ensureTable();
  const db = getDb();

  db.prepare(`
    INSERT INTO benchmark_runs (timestamp, profile, overall_score, result_json, config_snapshot)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    result.timestamp,
    result.profile,
    result.overallScore,
    JSON.stringify(result),
    configSnapshot ? JSON.stringify(configSnapshot) : null,
  );
}

/**
 * Get past benchmark runs (most recent first).
 */
export function getBenchmarkHistory(limit: number = 20): BenchmarkRunSummary[] {
  ensureTable();
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, timestamp, profile, overall_score
    FROM benchmark_runs
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    timestamp: string;
    profile: string;
    overall_score: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    profile: r.profile as CollectionBenchmarkResult['profile'],
    overallScore: r.overall_score,
  }));
}

/**
 * Get a full benchmark result by run ID.
 */
export function getBenchmarkRun(id: number): CollectionBenchmarkResult | null {
  ensureTable();
  const db = getDb();

  const row = db.prepare('SELECT result_json FROM benchmark_runs WHERE id = ?').get(id) as {
    result_json: string;
  } | undefined;

  if (!row) return null;
  return JSON.parse(row.result_json) as CollectionBenchmarkResult;
}

/**
 * Get the most recent benchmark run.
 */
export function getLatestBenchmarkRun(): CollectionBenchmarkResult | null {
  ensureTable();
  const db = getDb();

  const row = db.prepare(
    'SELECT result_json FROM benchmark_runs ORDER BY timestamp DESC LIMIT 1'
  ).get() as { result_json: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.result_json) as CollectionBenchmarkResult;
}

/**
 * Compute trend between two benchmark runs.
 */
export function computeTrend(
  previous: CollectionBenchmarkResult,
  current: CollectionBenchmarkResult,
): TrendReport {
  const metricDeltas: MetricDelta[] = [];

  // Overall score
  const scoreDelta = current.overallScore - previous.overallScore;

  // Health metrics
  addDelta(metricDeltas, 'Edge-to-Chunk Ratio',
    previous.collectionStats.edgeToChunkRatio,
    current.collectionStats.edgeToChunkRatio, true);
  addDelta(metricDeltas, 'Cluster Coverage',
    previous.collectionStats.clusterCoverage,
    current.collectionStats.clusterCoverage, true);
  addDelta(metricDeltas, 'Orphan Chunk %',
    previous.collectionStats.orphanChunkPercentage,
    current.collectionStats.orphanChunkPercentage, false);

  // Retrieval metrics
  if (previous.retrieval && current.retrieval) {
    addDelta(metricDeltas, 'Adjacent Recall@10',
      previous.retrieval.adjacentRecallAt10,
      current.retrieval.adjacentRecallAt10, true);
    addDelta(metricDeltas, 'Bridging Recall@10',
      previous.retrieval.bridgingRecallAt10,
      current.retrieval.bridgingRecallAt10, true);
    addDelta(metricDeltas, 'Precision@10',
      previous.retrieval.precisionAt10,
      current.retrieval.precisionAt10, true);
    addDelta(metricDeltas, 'Token Efficiency',
      previous.retrieval.tokenEfficiency,
      current.retrieval.tokenEfficiency, true);
  }

  // Graph value metrics
  if (previous.graphValue && current.graphValue) {
    addDelta(metricDeltas, 'Augmentation Ratio',
      previous.graphValue.sourceAttribution.augmentationRatio,
      current.graphValue.sourceAttribution.augmentationRatio, true);
    addDelta(metricDeltas, 'Graph Lift',
      previous.graphValue.lift,
      current.graphValue.lift, true);
  }

  // Latency metrics (lower is better)
  if (previous.latency && current.latency) {
    addDelta(metricDeltas, 'p95 Recall Latency (ms)',
      previous.latency.recall.p95,
      current.latency.recall.p95, false);
  }

  // Generate summary
  const improved = metricDeltas.filter(d => d.improved).length;
  const worsened = metricDeltas.filter(d => !d.improved && d.delta !== 0).length;
  const parts: string[] = [];
  parts.push(`Score ${scoreDelta >= 0 ? 'improved' : 'decreased'} from ${previous.overallScore.toFixed(0)} to ${current.overallScore.toFixed(0)} (${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(0)}).`);
  if (improved > 0) parts.push(`${improved} metric(s) improved.`);
  if (worsened > 0) parts.push(`${worsened} metric(s) worsened.`);

  return {
    overallScoreDelta: scoreDelta,
    metricDeltas,
    summary: parts.join(' '),
  };
}

function addDelta(
  deltas: MetricDelta[],
  metric: string,
  previous: number,
  current: number,
  higherIsBetter: boolean,
): void {
  const delta = current - previous;
  if (delta === 0) return;

  deltas.push({
    metric,
    previous,
    current,
    delta,
    improved: higherIsBetter ? delta > 0 : delta < 0,
  });
}
