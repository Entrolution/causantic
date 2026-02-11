/**
 * Tests for benchmark runner — scoring, highlights, and orchestration.
 */

import { describe, it, expect } from 'vitest';
import { computeOverallScore, generateHighlights } from '../../../src/eval/collection-benchmark/runner.js';
import type { HealthResult, RetrievalResult, GraphValueResult, LatencyResult } from '../../../src/eval/collection-benchmark/types.js';

function makeHealth(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    chunkCount: 100,
    projectCount: 2,
    sessionCount: 10,
    edgeCount: 300,
    edgeToChunkRatio: 3,
    clusterCount: 5,
    clusterCoverage: 0.87,
    orphanChunkPercentage: 0.04,
    temporalSpan: { earliest: '2024-01-01T00:00:00Z', latest: '2024-06-01T00:00:00Z' },
    edgeTypeDistribution: [],
    sessionSizeStats: { min: 2, max: 20, mean: 10, median: 9 },
    perProject: [],
    clusterQuality: null,
    ...overrides,
  };
}

function makeRetrieval(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    adjacentRecallAt5: 0.71,
    adjacentRecallAt10: 0.82,
    mrr: 0.67,
    bridgingRecallAt10: 0.58,
    bridgingVsRandom: 4.2,
    precisionAt5: 0.91,
    precisionAt10: 0.87,
    tokenEfficiency: 0.78,
    meanUsefulTokensPerQuery: 1200,
    ...overrides,
  };
}

function makeGraph(overrides: Partial<GraphValueResult> = {}): GraphValueResult {
  return {
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
    graphBoostedCount: 5,
    lift: 0.34,
    edgeTypeEffectiveness: [],
    ...overrides,
  };
}

function makeLatency(overrides: Partial<LatencyResult> = {}): LatencyResult {
  return {
    recall: { p50: 23, p95: 45, p99: 89 },
    explain: { p50: 31, p95: 52, p99: 95 },
    predict: { p50: 28, p95: 48, p99: 91 },
    reconstruct: { p50: 12, p95: 28, p99: 42 },
    ...overrides,
  };
}

describe('computeOverallScore', () => {
  it('should score health only (quick profile)', () => {
    const health = makeHealth();
    const score = computeOverallScore(health);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should score health + retrieval (standard profile)', () => {
    const health = makeHealth();
    const retrieval = makeRetrieval();
    const score = computeOverallScore(health, retrieval);
    expect(score).toBeGreaterThan(50);
  });

  it('should score all categories (full profile)', () => {
    const health = makeHealth();
    const retrieval = makeRetrieval();
    const graph = makeGraph();
    const latency = makeLatency();
    const score = computeOverallScore(health, retrieval, graph, latency);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should give lower score for poor health', () => {
    const goodHealth = makeHealth({ edgeToChunkRatio: 3, clusterCoverage: 0.9, orphanChunkPercentage: 0.02 });
    const poorHealth = makeHealth({ edgeToChunkRatio: 0.1, clusterCoverage: 0.2, orphanChunkPercentage: 0.5 });

    const goodScore = computeOverallScore(goodHealth);
    const poorScore = computeOverallScore(poorHealth);

    expect(goodScore).toBeGreaterThan(poorScore);
  });

  it('should give higher score for good retrieval', () => {
    const health = makeHealth();
    const goodRetrieval = makeRetrieval({
      adjacentRecallAt10: 0.9,
      precisionAt10: 0.95,
      bridgingRecallAt10: 0.8,
      tokenEfficiency: 0.9,
    });
    const poorRetrieval = makeRetrieval({
      adjacentRecallAt10: 0.1,
      precisionAt10: 0.2,
      bridgingRecallAt10: 0.05,
      tokenEfficiency: 0.1,
    });

    const goodScore = computeOverallScore(health, goodRetrieval);
    const poorScore = computeOverallScore(health, poorRetrieval);

    expect(goodScore).toBeGreaterThan(poorScore);
  });

  it('should penalize high latency', () => {
    const health = makeHealth();
    const fastLatency = makeLatency({ recall: { p50: 10, p95: 30, p99: 50 } });
    const slowLatency = makeLatency({ recall: { p50: 200, p95: 800, p99: 1500 } });

    const fastScore = computeOverallScore(health, undefined, undefined, fastLatency);
    const slowScore = computeOverallScore(health, undefined, undefined, slowLatency);

    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it('should return 0 for empty inputs', () => {
    const health = makeHealth({
      edgeToChunkRatio: 0,
      clusterCoverage: 0,
      orphanChunkPercentage: 1,
      chunkCount: 0,
    });
    const score = computeOverallScore(health);
    expect(score).toBe(0);
  });
});

describe('generateHighlights', () => {
  it('should generate health highlights', () => {
    const health = makeHealth();
    const highlights = generateHighlights(health);

    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.some(h => h.includes('cluster'))).toBe(true);
  });

  it('should include retrieval highlights when available', () => {
    const health = makeHealth();
    const retrieval = makeRetrieval();
    const highlights = generateHighlights(health, retrieval);

    expect(highlights.some(h => h.includes('recall') || h.includes('Recall'))).toBe(true);
  });

  it('should include graph highlights when available', () => {
    const health = makeHealth();
    const graph = makeGraph();
    const highlights = generateHighlights(health, undefined, graph);

    expect(highlights.some(h => h.includes('Graph') || h.includes('graph'))).toBe(true);
  });

  it('should include latency highlights when available', () => {
    const health = makeHealth();
    const latency = makeLatency();
    const highlights = generateHighlights(health, undefined, undefined, latency);

    expect(highlights.some(h => h.includes('p95') || h.includes('latency'))).toBe(true);
  });
});
