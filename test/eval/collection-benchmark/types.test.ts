/**
 * Tests for benchmark type definitions — validates interface shapes.
 */

import { describe, it, expect } from 'vitest';
import type {
  BenchmarkProfile,
  BenchmarkCategory,
  HealthResult,
  RetrievalResult,
  GraphValueResult,
  LatencyResult,
  TuningRecommendation,
  SkippedBenchmark,
  CollectionBenchmarkResult,
  BenchmarkSample,
  TrendReport,
  BenchmarkRunSummary,
} from '../../../src/eval/collection-benchmark/types.js';

describe('collection-benchmark/types', () => {
  it('should allow valid BenchmarkProfile values', () => {
    const profiles: BenchmarkProfile[] = ['quick', 'standard', 'full'];
    expect(profiles).toHaveLength(3);
  });

  it('should allow valid BenchmarkCategory values', () => {
    const categories: BenchmarkCategory[] = ['health', 'retrieval', 'graph', 'latency'];
    expect(categories).toHaveLength(4);
  });

  it('should represent a valid HealthResult', () => {
    const health: HealthResult = {
      chunkCount: 100,
      projectCount: 2,
      sessionCount: 10,
      edgeCount: 300,
      edgeToChunkRatio: 3,
      clusterCount: 5,
      clusterCoverage: 0.87,
      orphanChunkPercentage: 0.04,
      temporalSpan: { earliest: '2024-01-01T00:00:00Z', latest: '2024-06-01T00:00:00Z' },
      edgeTypeDistribution: [
        { type: 'file-path', count: 100, percentage: 0.33 },
      ],
      sessionSizeStats: { min: 2, max: 20, mean: 10, median: 9 },
      perProject: [
        { slug: 'my-app', chunkCount: 60, edgeCount: 200, clusterCount: 3, orphanPercentage: 0.02 },
      ],
      clusterQuality: { intraClusterSimilarity: 0.82, interClusterSeparation: 0.45, coherenceScore: 0.65 },
    };
    expect(health.chunkCount).toBe(100);
    expect(health.clusterQuality?.coherenceScore).toBe(0.65);
  });

  it('should represent a valid RetrievalResult', () => {
    const retrieval: RetrievalResult = {
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
    expect(retrieval.adjacentRecallAt10).toBe(0.82);
  });

  it('should represent a valid GraphValueResult', () => {
    const graph: GraphValueResult = {
      sourceAttribution: {
        vectorPercentage: 0.45,
        keywordPercentage: 0.20,
        clusterPercentage: 0.15,
        graphPercentage: 0.20,
        augmentationRatio: 2.3,
      },
      fullRecallAt10: 0.82,
      vectorOnlyRecallAt10: 0.61,
      uniqueGraphFinds: 42,
      lift: 0.34,
      edgeTypeEffectiveness: [
        { type: 'file-path', chunksSurfaced: 847, recallContribution: 0.38 },
      ],
    };
    expect(graph.sourceAttribution.augmentationRatio).toBe(2.3);
  });

  it('should represent a valid LatencyResult', () => {
    const latency: LatencyResult = {
      recall: { p50: 23, p95: 45, p99: 89 },
      explain: { p50: 31, p95: 52, p99: 95 },
      predict: { p50: 28, p95: 48, p99: 91 },
      reconstruct: { p50: 12, p95: 28, p99: 42 },
    };
    expect(latency.recall.p95).toBe(45);
  });

  it('should represent a valid TuningRecommendation', () => {
    const rec: TuningRecommendation = {
      metric: 'Cluster coverage',
      currentValue: 'clustering.threshold: 0.09',
      suggestedValue: 'clustering.threshold: 0.12',
      configPath: 'clustering.threshold',
      impact: 'May improve coverage from 62% to ~80%',
      priority: 'high',
    };
    expect(rec.priority).toBe('high');
  });

  it('should represent a valid CollectionBenchmarkResult', () => {
    const result: CollectionBenchmarkResult = {
      timestamp: '2025-01-15T10:30:00Z',
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
      overallScore: 78,
      highlights: ['Test highlight'],
      skipped: [],
    };
    expect(result.overallScore).toBe(78);
    expect(result.retrieval).toBeUndefined();
  });

  it('should represent a valid SkippedBenchmark', () => {
    const skipped: SkippedBenchmark = {
      name: 'Adjacent Chunk Recall',
      reason: 'Skipped: need >=3 sessions, you have 1',
      threshold: '>=3 sessions',
      current: '1 session',
    };
    expect(skipped.name).toBe('Adjacent Chunk Recall');
  });

  it('should represent a valid BenchmarkSample', () => {
    const sample: BenchmarkSample = {
      queryChunkIds: ['chunk-1', 'chunk-2'],
      adjacentPairs: [
        { queryChunkId: 'chunk-1', adjacentChunkId: 'chunk-2', sessionId: 'session-1' },
      ],
      crossSessionPairs: [],
      crossProjectPairs: [],
      thresholds: {
        canRunAdjacentRecall: true,
        canRunCrossSessionBridging: false,
        canRunPrecisionAtK: false,
        reasons: new Map([['crossSessionBridging', 'need >=3 sessions']]),
      },
    };
    expect(sample.adjacentPairs).toHaveLength(1);
  });

  it('should represent a valid TrendReport', () => {
    const trend: TrendReport = {
      overallScoreDelta: 5,
      metricDeltas: [
        { metric: 'Recall@10', previous: 0.75, current: 0.82, delta: 0.07, improved: true },
      ],
      summary: 'Score improved from 73 to 78 (+5).',
    };
    expect(trend.overallScoreDelta).toBe(5);
  });

  it('should represent a valid BenchmarkRunSummary', () => {
    const summary: BenchmarkRunSummary = {
      id: 1,
      timestamp: '2025-01-15T10:30:00Z',
      profile: 'standard',
      overallScore: 78,
    };
    expect(summary.id).toBe(1);
  });
});
