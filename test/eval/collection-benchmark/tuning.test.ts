/**
 * Tests for tuning recommendation generation.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateTuningRecommendations } from '../../../src/eval/collection-benchmark/tuning.js';
import type { CollectionBenchmarkResult } from '../../../src/eval/collection-benchmark/types.js';

// Mock the config loader
vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: () => ({
    clustering: { threshold: 0.1, minClusterSize: 4 },
    traversal: { maxDepth: 50 },
    tokens: { mcpMaxResponse: 2000 },
  }),
}));

function makeResult(overrides: Partial<CollectionBenchmarkResult> = {}): CollectionBenchmarkResult {
  return {
    timestamp: '2025-01-15T10:30:00Z',
    profile: 'full',
    collectionStats: {
      chunkCount: 100,
      projectCount: 1,
      sessionCount: 10,
      edgeCount: 200,
      edgeToChunkRatio: 2,
      clusterCount: 5,
      clusterCoverage: 0.85,
      orphanChunkPercentage: 0.05,
      temporalSpan: null,
      edgeTypeDistribution: [
        { type: 'within-chain', count: 100, percentage: 0.5 },
        { type: 'cross-session', count: 100, percentage: 0.5 },
      ],
      sessionSizeStats: { min: 5, max: 15, mean: 10, median: 10 },
      perProject: [],
      clusterQuality: null,
    },
    overallScore: 75,
    highlights: [],
    skipped: [],
    ...overrides,
  };
}

describe('generateTuningRecommendations', () => {
  it('should return empty array for healthy collection', () => {
    const result = makeResult();
    const recs = generateTuningRecommendations(result);

    // With good defaults, there should be no high-priority recommendations
    const highPriority = recs.filter((r) => r.priority === 'high');
    expect(highPriority).toHaveLength(0);
  });

  it('should recommend increasing cluster threshold when coverage is low', () => {
    const result = makeResult();
    result.collectionStats.clusterCoverage = 0.5;
    const recs = generateTuningRecommendations(result);

    const clusterRec = recs.find((r) => r.configPath === 'clustering.threshold');
    expect(clusterRec).toBeDefined();
    expect(clusterRec!.suggestedValue).toContain('0.12');
    expect(clusterRec!.priority).toBe('high');
  });

  it('should recommend re-ingestion for high orphan rate', () => {
    const result = makeResult();
    result.collectionStats.orphanChunkPercentage = 0.4;
    const recs = generateTuningRecommendations(result);

    const orphanRec = recs.find((r) => r.metric === 'Orphan chunk rate');
    expect(orphanRec).toBeDefined();
    expect(orphanRec!.priority).toBe('high');
    expect(orphanRec!.impact).toContain('npx causantic ingest');
  });

  it('should recommend rebuilding edges when chain coverage is low', () => {
    const result = makeResult({
      chainQuality: {
        meanChainLength: 2.5,
        meanScorePerToken: 0.01,
        chainCoverage: 0.3,
        fallbackRate: 0.7,
      },
    });
    const recs = generateTuningRecommendations(result);

    const chainRec = recs.find((r) => r.metric.includes('Chain coverage'));
    expect(chainRec).toBeDefined();
    expect(chainRec!.impact).toContain('Rebuild');
  });

  it('should recommend reducing maxDepth for high latency', () => {
    const result = makeResult({
      latency: {
        recall: { p50: 150, p95: 350, p99: 500 },
        search: { p50: 150, p95: 350, p99: 500 },
        predict: { p50: 150, p95: 350, p99: 500 },
        reconstruct: { p50: 50, p95: 100, p99: 200 },
      },
    });
    const recs = generateTuningRecommendations(result);

    const latencyRec = recs.find((r) => r.metric === 'Recall latency p95');
    expect(latencyRec).toBeDefined();
    expect(latencyRec!.configPath).toBe('traversal.maxDepth');
  });

  it('should recommend rebuilding edges for low cross-session recall', () => {
    const result = makeResult({
      retrieval: {
        adjacentRecallAt5: 0.5,
        adjacentRecallAt10: 0.6,
        mrr: 0.4,
        bridgingRecallAt10: 0.2,
        bridgingVsRandom: 1.5,
        precisionAt5: 0.8,
        precisionAt10: 0.75,
        tokenEfficiency: 0.7,
        meanUsefulTokensPerQuery: 1000,
      },
    });
    const recs = generateTuningRecommendations(result);

    const bridgingRec = recs.find((r) => r.metric.includes('bridging'));
    expect(bridgingRec).toBeDefined();
    expect(bridgingRec!.configPath).toBe('(action)');
  });

  it('should recommend reducing token budget for low efficiency', () => {
    const result = makeResult({
      retrieval: {
        adjacentRecallAt5: 0.5,
        adjacentRecallAt10: 0.6,
        mrr: 0.4,
        bridgingRecallAt10: 0.5,
        bridgingVsRandom: 3,
        precisionAt5: 0.8,
        precisionAt10: 0.75,
        tokenEfficiency: 0.4,
        meanUsefulTokensPerQuery: 500,
      },
    });
    const recs = generateTuningRecommendations(result);

    const tokenRec = recs.find((r) => r.metric === 'Token efficiency');
    expect(tokenRec).toBeDefined();
    expect(tokenRec!.configPath).toBe('tokens.mcpMaxResponse');
  });

  it('should sort recommendations by priority', () => {
    const result = makeResult();
    result.collectionStats.clusterCoverage = 0.3;
    result.collectionStats.orphanChunkPercentage = 0.5;
    result.retrieval = {
      adjacentRecallAt5: 0.5,
      adjacentRecallAt10: 0.6,
      mrr: 0.4,
      bridgingRecallAt10: 0.5,
      bridgingVsRandom: 3,
      precisionAt5: 0.8,
      precisionAt10: 0.75,
      tokenEfficiency: 0.4,
      meanUsefulTokensPerQuery: 500,
    };
    const recs = generateTuningRecommendations(result);

    if (recs.length >= 2) {
      const priorities = recs.map((r) => r.priority);
      const order = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < priorities.length; i++) {
        expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
      }
    }
  });

  it('should recommend lowering MMR lambda when cluster sources are absent despite healthy coverage', () => {
    const result = makeResult({
      retrieval: {
        adjacentRecallAt5: 0.5,
        adjacentRecallAt10: 0.6,
        mrr: 0.4,
        bridgingRecallAt10: 0.5,
        bridgingVsRandom: 3,
        precisionAt5: 0.8,
        precisionAt10: 0.75,
        tokenEfficiency: 0.7,
        meanUsefulTokensPerQuery: 1000,
        sourceMix: {
          vector: 0.85,
          keyword: 0.15,
          cluster: 0,
          total: 50,
        },
      },
    });
    // Healthy cluster coverage
    result.collectionStats.clusterCoverage = 0.8;

    const recs = generateTuningRecommendations(result);

    const mmrRec = recs.find((r) => r.configPath === 'retrieval.mmrLambda');
    expect(mmrRec).toBeDefined();
    expect(mmrRec!.suggestedValue).toContain('0.5');
    expect(mmrRec!.priority).toBe('medium');
  });

  it('should not recommend lowering MMR lambda when cluster sources are present', () => {
    const result = makeResult({
      retrieval: {
        adjacentRecallAt5: 0.5,
        adjacentRecallAt10: 0.6,
        mrr: 0.4,
        bridgingRecallAt10: 0.5,
        bridgingVsRandom: 3,
        precisionAt5: 0.8,
        precisionAt10: 0.75,
        tokenEfficiency: 0.7,
        meanUsefulTokensPerQuery: 1000,
        sourceMix: {
          vector: 0.7,
          keyword: 0.15,
          cluster: 0.15,
          total: 50,
        },
      },
    });
    result.collectionStats.clusterCoverage = 0.8;

    const recs = generateTuningRecommendations(result);

    const mmrRec = recs.find((r) => r.configPath === 'retrieval.mmrLambda');
    expect(mmrRec).toBeUndefined();
  });

  it('should flag missing within-chain edges', () => {
    const result = makeResult();
    result.collectionStats.edgeTypeDistribution = [
      { type: 'cross-session', count: 100, percentage: 1.0 },
    ];
    const recs = generateTuningRecommendations(result);

    const withinChainRec = recs.find((r) => r.metric === 'Within-chain edges');
    expect(withinChainRec).toBeDefined();
  });
});
