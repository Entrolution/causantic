/**
 * Tests for Markdown + JSON report generation.
 */

import { describe, it, expect } from 'vitest';
import { generateMarkdownReport } from '../../../src/eval/collection-benchmark/reporter.js';
import type { CollectionBenchmarkResult } from '../../../src/eval/collection-benchmark/types.js';

function makeMinimalResult(
  overrides: Partial<CollectionBenchmarkResult> = {},
): CollectionBenchmarkResult {
  return {
    timestamp: '2025-01-15T10:30:00Z',
    profile: 'standard',
    collectionStats: {
      chunkCount: 2847,
      projectCount: 3,
      sessionCount: 142,
      edgeCount: 8412,
      edgeToChunkRatio: 2.95,
      clusterCount: 30,
      clusterCoverage: 0.87,
      orphanChunkPercentage: 0.042,
      temporalSpan: { earliest: '2024-08-15T00:00:00Z', latest: '2025-01-15T00:00:00Z' },
      edgeTypeDistribution: [
        { type: 'within-chain', count: 2847, percentage: 0.338 },
        { type: 'cross-session', count: 1923, percentage: 0.229 },
        { type: 'brief', count: 1560, percentage: 0.185 },
      ],
      sessionSizeStats: { min: 1, max: 45, mean: 20, median: 18 },
      perProject: [
        {
          slug: 'my-app',
          chunkCount: 1842,
          edgeCount: 5891,
          clusterCount: 18,
          orphanPercentage: 0.031,
        },
        {
          slug: 'api-server',
          chunkCount: 724,
          edgeCount: 1921,
          clusterCount: 8,
          orphanPercentage: 0.058,
        },
        {
          slug: 'shared-lib',
          chunkCount: 281,
          edgeCount: 600,
          clusterCount: 4,
          orphanPercentage: 0.071,
        },
      ],
      clusterQuality: {
        intraClusterSimilarity: 0.82,
        interClusterSeparation: 0.45,
        coherenceScore: 0.65,
      },
    },
    overallScore: 78,
    highlights: [
      'Graph traversal adds 2.3x more relevant results vs vector-only',
      '87% of chunks organized into topic clusters',
    ],
    skipped: [],
    ...overrides,
  };
}

describe('generateMarkdownReport', () => {
  it('should include title and overall score', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('# Causantic Collection Benchmark Report');
    expect(md).toContain('## Overall Score: 78/100');
  });

  it('should include highlights', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('Graph traversal adds 2.3x');
    expect(md).toContain('87% of chunks');
  });

  it('should include health metrics table', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Collection Health');
    expect(md).toContain('| Chunks | 2,847 |');
    expect(md).toContain('| Projects | 3 |');
    expect(md).toContain('| Edge-to-chunk ratio | 2.95 |');
    expect(md).toContain('| Cluster coverage | 87.0% |');
  });

  it('should include per-project breakdown', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('### Per-Project Breakdown');
    expect(md).toContain('| my-app |');
    expect(md).toContain('| api-server |');
    expect(md).toContain('| shared-lib |');
  });

  it('should include edge type distribution', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('### Edge Type Distribution');
    expect(md).toContain('| within-chain |');
    expect(md).toContain('| cross-session |');
  });

  it('should include cluster quality when available', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('### Cluster Quality');
    expect(md).toContain('Intra-cluster similarity');
  });

  it('should include retrieval section when available', () => {
    const result = makeMinimalResult({
      retrieval: {
        adjacentRecallAt5: 0.71,
        adjacentRecallAt10: 0.82,
        mrr: 0.67,
        bridgingRecallAt10: 0.58,
        bridgingVsRandom: 4.2,
        precisionAt5: 0.91,
        precisionAt10: 0.87,
        tokenEfficiency: 0.78,
        meanUsefulTokensPerQuery: 1200,
      },
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Retrieval Quality');
    expect(md).toContain('| Adjacent Recall@10 | 0.82 |');
    expect(md).toContain('| Token Efficiency | 78% |');
  });

  it('should include chain quality section when available', () => {
    const result = makeMinimalResult({
      chainQuality: {
        meanChainLength: 4.2,
        meanScorePerToken: 0.015,
        chainCoverage: 0.65,
        fallbackRate: 0.35,
      },
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Chain Quality');
    expect(md).toContain('4.2 chunks');
    expect(md).toContain('65%');
  });

  it('should include latency section when available', () => {
    const result = makeMinimalResult({
      latency: {
        recall: { p50: 23, p95: 45, p99: 89 },
        search: { p50: 31, p95: 52, p99: 95 },
        predict: { p50: 28, p95: 48, p99: 91 },
        reconstruct: { p50: 12, p95: 28, p99: 42 },
      },
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Latency');
    expect(md).toContain('| recall | 23ms | 45ms | 89ms |');
  });

  it('should include skipped benchmarks when present', () => {
    const result = makeMinimalResult({
      skipped: [
        {
          name: 'Cross-Session Bridging',
          reason: 'Skipped: need >=3 sessions',
          threshold: '>=3 sessions',
          current: '1 session',
        },
      ],
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('### Skipped Benchmarks');
    expect(md).toContain('Cross-Session Bridging');
  });

  it('should include tuning recommendations', () => {
    const result = makeMinimalResult({
      tuning: [
        {
          metric: 'Cluster coverage',
          currentValue: 'clustering.threshold: 0.09',
          suggestedValue: 'clustering.threshold: 0.12',
          configPath: 'clustering.threshold',
          impact: 'May improve coverage',
          priority: 'high',
        },
        {
          metric: 'Graph utilization',
          currentValue: 'traversal.maxDepth: 20',
          suggestedValue: 'traversal.maxDepth: 25',
          configPath: 'traversal.maxDepth',
          impact: 'May surface more results',
          priority: 'medium',
        },
      ],
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Tuning Recommendations');
    expect(md).toContain('### High Priority');
    expect(md).toContain('### Medium Priority');
    expect(md).toContain('Cluster coverage');
    expect(md).toContain('Graph utilization');
  });

  it('should include trend when available', () => {
    const result = makeMinimalResult({
      trend: {
        overallScoreDelta: 5,
        metricDeltas: [
          {
            metric: 'Adjacent Recall@10',
            previous: 0.75,
            current: 0.82,
            delta: 0.07,
            improved: true,
          },
        ],
        summary: 'Score improved from 73 to 78 (+5).',
      },
    });
    const md = generateMarkdownReport(result);

    expect(md).toContain('## Trend');
    expect(md).toContain('Adjacent Recall@10');
    expect(md).toContain('Score improved');
  });

  it('should not include per-project breakdown for single project', () => {
    const result = makeMinimalResult();
    result.collectionStats.perProject = [
      {
        slug: 'only-project',
        chunkCount: 100,
        edgeCount: 200,
        clusterCount: 5,
        orphanPercentage: 0.05,
      },
    ];
    const md = generateMarkdownReport(result);

    expect(md).not.toContain('### Per-Project Breakdown');
  });

  it('should include footer with run command', () => {
    const result = makeMinimalResult();
    const md = generateMarkdownReport(result);

    expect(md).toContain('*Run with: `npx causantic benchmark-collection');
    expect(md).toContain('Re-run after tuning');
  });
});
