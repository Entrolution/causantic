/**
 * Type definitions for the collection benchmark suite.
 *
 * Provides interfaces for all benchmark categories, results, and configuration.
 */

import type { ReferenceType } from '../../storage/types.js';

// ─── Benchmark Profiles ──────────────────────────────────────────────────────

export type BenchmarkProfile = 'quick' | 'standard' | 'full';

export type BenchmarkCategory = 'health' | 'retrieval' | 'chain' | 'latency';

// ─── Health Results ──────────────────────────────────────────────────────────

export interface EdgeTypeDistribution {
  type: ReferenceType;
  count: number;
  percentage: number;
}

export interface SessionSizeStats {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface ClusterQuality {
  intraClusterSimilarity: number;
  interClusterSeparation: number;
  coherenceScore: number;
}

export interface ProjectBreakdown {
  slug: string;
  chunkCount: number;
  edgeCount: number;
  clusterCount: number;
  orphanPercentage: number;
}

export interface HealthResult {
  chunkCount: number;
  projectCount: number;
  sessionCount: number;
  edgeCount: number;
  edgeToChunkRatio: number;
  clusterCount: number;
  clusterCoverage: number;
  orphanChunkPercentage: number;
  temporalSpan: { earliest: string; latest: string } | null;
  edgeTypeDistribution: EdgeTypeDistribution[];
  sessionSizeStats: SessionSizeStats | null;
  perProject: ProjectBreakdown[];
  clusterQuality: ClusterQuality | null;
}

// ─── Retrieval Results ───────────────────────────────────────────────────────

export interface RetrievalResult {
  adjacentRecallAt5: number;
  adjacentRecallAt10: number;
  mrr: number;
  bridgingRecallAt10: number;
  bridgingVsRandom: number;
  precisionAt5: number;
  precisionAt10: number;
  tokenEfficiency: number;
  meanUsefulTokensPerQuery: number;
  sourceMix?: {
    vector: number;
    keyword: number;
    cluster: number;
    total: number;
  };
}

// ─── Chain Quality Results ───────────────────────────────────────────────────

export interface ChainQualityResult {
  /** Mean number of chunks per chain (higher = richer narrative) */
  meanChainLength: number;
  /** Mean chain score / token count (higher = more relevant per token) */
  meanScorePerToken: number;
  /** Fraction of queries that produced a chain (vs search fallback) */
  chainCoverage: number;
  /** Fraction of queries that fell back to search (no qualifying chain) */
  fallbackRate: number;
}

// ─── Latency Results ─────────────────────────────────────────────────────────

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface LatencyResult {
  recall: LatencyPercentiles;
  search: LatencyPercentiles;
  predict: LatencyPercentiles;
  reconstruct: LatencyPercentiles;
}

// ─── Tuning ──────────────────────────────────────────────────────────────────

export interface TuningRecommendation {
  metric: string;
  currentValue: string;
  suggestedValue: string;
  configPath: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

// ─── Skipped Benchmarks ─────────────────────────────────────────────────────

export interface SkippedBenchmark {
  name: string;
  reason: string;
  threshold: string;
  current: string;
}

// ─── Historical Trending ─────────────────────────────────────────────────────

export interface MetricDelta {
  metric: string;
  previous: number;
  current: number;
  delta: number;
  improved: boolean;
}

export interface TrendReport {
  overallScoreDelta: number;
  metricDeltas: MetricDelta[];
  summary: string;
}

export interface BenchmarkRunSummary {
  id: number;
  timestamp: string;
  profile: BenchmarkProfile;
  overallScore: number;
}

// ─── Sampler ─────────────────────────────────────────────────────────────────

export interface AdjacentPair {
  queryChunkId: string;
  adjacentChunkId: string;
  sessionId: string;
}

export interface CrossSessionPair {
  chunkIdA: string;
  chunkIdB: string;
  edgeType: ReferenceType;
}

export interface CrossProjectPair {
  chunkIdA: string;
  projectA: string;
  chunkIdB: string;
  projectB: string;
}

export interface SamplerThresholds {
  canRunAdjacentRecall: boolean;
  canRunCrossSessionBridging: boolean;
  canRunPrecisionAtK: boolean;
  reasons: Map<string, string>;
}

export interface BenchmarkSample {
  queryChunkIds: string[];
  adjacentPairs: AdjacentPair[];
  crossSessionPairs: CrossSessionPair[];
  crossProjectPairs: CrossProjectPair[];
  thresholds: SamplerThresholds;
}

export interface SamplerOptions {
  sampleSize: number;
  seed?: number;
  projectFilter?: string;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export interface CollectionBenchmarkOptions {
  profile?: BenchmarkProfile;
  categories?: BenchmarkCategory[];
  sampleSize?: number;
  seed?: number;
  projectFilter?: string;
  topK?: number;
  includeTuning?: boolean;
  onProgress?: (msg: string) => void;
}

export interface CollectionBenchmarkResult {
  timestamp: string;
  profile: BenchmarkProfile;
  collectionStats: HealthResult;
  retrieval?: RetrievalResult;
  chainQuality?: ChainQualityResult;
  latency?: LatencyResult;
  overallScore: number;
  highlights: string[];
  skipped: SkippedBenchmark[];
  tuning?: TuningRecommendation[];
  trend?: TrendReport;
}
