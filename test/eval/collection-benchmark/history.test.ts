/**
 * Tests for benchmark history storage and trending.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, setupTestDb, teardownTestDb } from '../../storage/test-utils.js';
import {
  storeBenchmarkRun,
  getBenchmarkHistory,
  getBenchmarkRun,
  getLatestBenchmarkRun,
  computeTrend,
} from '../../../src/eval/collection-benchmark/history.js';
import type { CollectionBenchmarkResult } from '../../../src/eval/collection-benchmark/types.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

function makeResult(score: number, timestamp: string): CollectionBenchmarkResult {
  return {
    timestamp,
    profile: 'standard',
    collectionStats: {
      chunkCount: 100,
      projectCount: 1,
      sessionCount: 5,
      edgeCount: 200,
      edgeToChunkRatio: 2,
      clusterCount: 3,
      clusterCoverage: 0.8,
      orphanChunkPercentage: 0.05,
      temporalSpan: null,
      edgeTypeDistribution: [],
      sessionSizeStats: null,
      perProject: [],
      clusterQuality: null,
    },
    overallScore: score,
    highlights: [],
    skipped: [],
  };
}

describe('storeBenchmarkRun', () => {
  it('should store a benchmark run', () => {
    const result = makeResult(75, '2025-01-10T10:00:00Z');
    storeBenchmarkRun(result);

    const history = getBenchmarkHistory();
    expect(history).toHaveLength(1);
    expect(history[0].overallScore).toBe(75);
    expect(history[0].profile).toBe('standard');
  });

  it('should store with config snapshot', () => {
    const result = makeResult(75, '2025-01-10T10:00:00Z');
    storeBenchmarkRun(result, { clustering: { threshold: 0.09 } });

    const history = getBenchmarkHistory();
    expect(history).toHaveLength(1);
  });
});

describe('getBenchmarkHistory', () => {
  it('should return empty array with no runs', () => {
    const history = getBenchmarkHistory();
    expect(history).toHaveLength(0);
  });

  it('should return runs in reverse chronological order', () => {
    storeBenchmarkRun(makeResult(70, '2025-01-08T10:00:00Z'));
    storeBenchmarkRun(makeResult(75, '2025-01-10T10:00:00Z'));
    storeBenchmarkRun(makeResult(78, '2025-01-12T10:00:00Z'));

    const history = getBenchmarkHistory();
    expect(history).toHaveLength(3);
    expect(history[0].overallScore).toBe(78);
    expect(history[2].overallScore).toBe(70);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 5; i++) {
      storeBenchmarkRun(makeResult(70 + i, `2025-01-${10 + i}T10:00:00Z`));
    }

    const history = getBenchmarkHistory(3);
    expect(history).toHaveLength(3);
  });
});

describe('getBenchmarkRun', () => {
  it('should return null for non-existent run', () => {
    const run = getBenchmarkRun(999);
    expect(run).toBeNull();
  });

  it('should return full result for existing run', () => {
    storeBenchmarkRun(makeResult(75, '2025-01-10T10:00:00Z'));
    const history = getBenchmarkHistory();
    const run = getBenchmarkRun(history[0].id);

    expect(run).not.toBeNull();
    expect(run!.overallScore).toBe(75);
    expect(run!.collectionStats.chunkCount).toBe(100);
  });
});

describe('getLatestBenchmarkRun', () => {
  it('should return null with no runs', () => {
    const latest = getLatestBenchmarkRun();
    expect(latest).toBeNull();
  });

  it('should return the most recent run', () => {
    storeBenchmarkRun(makeResult(70, '2025-01-08T10:00:00Z'));
    storeBenchmarkRun(makeResult(78, '2025-01-12T10:00:00Z'));
    storeBenchmarkRun(makeResult(75, '2025-01-10T10:00:00Z'));

    const latest = getLatestBenchmarkRun();
    expect(latest).not.toBeNull();
    expect(latest!.overallScore).toBe(78);
  });
});

describe('computeTrend', () => {
  it('should compute positive trend', () => {
    const previous = makeResult(73, '2025-01-08T10:00:00Z');
    const current = makeResult(78, '2025-01-12T10:00:00Z');

    const trend = computeTrend(previous, current);

    expect(trend.overallScoreDelta).toBe(5);
    expect(trend.summary).toContain('improved');
  });

  it('should compute negative trend', () => {
    const previous = makeResult(78, '2025-01-08T10:00:00Z');
    const current = makeResult(73, '2025-01-12T10:00:00Z');

    const trend = computeTrend(previous, current);

    expect(trend.overallScoreDelta).toBe(-5);
    expect(trend.summary).toContain('decreased');
  });

  it('should track metric deltas', () => {
    const previous = makeResult(73, '2025-01-08T10:00:00Z');
    previous.collectionStats.clusterCoverage = 0.7;
    const current = makeResult(78, '2025-01-12T10:00:00Z');
    current.collectionStats.clusterCoverage = 0.85;

    const trend = computeTrend(previous, current);

    const coverageDelta = trend.metricDeltas.find(d => d.metric === 'Cluster Coverage');
    expect(coverageDelta).toBeDefined();
    expect(coverageDelta!.improved).toBe(true);
    expect(coverageDelta!.delta).toBeCloseTo(0.15);
  });

  it('should track retrieval metric deltas', () => {
    const previous = makeResult(73, '2025-01-08T10:00:00Z');
    previous.retrieval = {
      adjacentRecallAt5: 0.6,
      adjacentRecallAt10: 0.75,
      mrr: 0.55,
      bridgingRecallAt10: 0.4,
      bridgingVsRandom: 3,
      precisionAt5: 0.85,
      precisionAt10: 0.80,
      tokenEfficiency: 0.7,
      meanUsefulTokensPerQuery: 1000,
    };
    const current = makeResult(78, '2025-01-12T10:00:00Z');
    current.retrieval = {
      adjacentRecallAt5: 0.71,
      adjacentRecallAt10: 0.82,
      mrr: 0.67,
      bridgingRecallAt10: 0.58,
      bridgingVsRandom: 4.2,
      precisionAt5: 0.91,
      precisionAt10: 0.87,
      tokenEfficiency: 0.78,
      meanUsefulTokensPerQuery: 1200,
    };

    const trend = computeTrend(previous, current);

    const recallDelta = trend.metricDeltas.find(d => d.metric === 'Adjacent Recall@10');
    expect(recallDelta).toBeDefined();
    expect(recallDelta!.improved).toBe(true);
  });

  it('should correctly identify latency regression', () => {
    const previous = makeResult(78, '2025-01-08T10:00:00Z');
    previous.latency = {
      recall: { p50: 20, p95: 38, p99: 80 },
      explain: { p50: 25, p95: 42, p99: 85 },
      predict: { p50: 22, p95: 40, p99: 82 },
      reconstruct: { p50: 10, p95: 20, p99: 35 },
    };
    const current = makeResult(75, '2025-01-12T10:00:00Z');
    current.latency = {
      recall: { p50: 30, p95: 55, p99: 120 },
      explain: { p50: 35, p95: 60, p99: 130 },
      predict: { p50: 32, p95: 57, p99: 125 },
      reconstruct: { p50: 15, p95: 30, p99: 50 },
    };

    const trend = computeTrend(previous, current);

    const latencyDelta = trend.metricDeltas.find(d => d.metric.includes('Latency'));
    expect(latencyDelta).toBeDefined();
    expect(latencyDelta!.improved).toBe(false); // Higher latency = worse
  });
});
