/**
 * Benchmark orchestrator.
 *
 * Runs all benchmark categories based on profile, generates samples,
 * computes composite scores, and assembles the final result.
 */

import { generateSamples } from './sampler.js';
import { runHealthBenchmarks } from './health.js';
import { runRetrievalBenchmarks } from './retrieval.js';
import { runGraphValueBenchmarks } from './graph-value.js';
import { runLatencyBenchmarks } from './latency.js';
import { generateTuningRecommendations } from './tuning.js';
import { storeBenchmarkRun, getLatestBenchmarkRun, computeTrend } from './history.js';
import { loadConfig } from '../../config/loader.js';
import { getDistinctProjects } from '../../storage/chunk-store.js';
import type {
  BenchmarkProfile,
  BenchmarkCategory,
  CollectionBenchmarkOptions,
  CollectionBenchmarkResult,
  SkippedBenchmark,
  HealthResult,
  RetrievalResult,
  GraphValueResult,
  LatencyResult,
  TuningRecommendation,
  TrendReport,
} from './types.js';

/**
 * Resolve profile to category list.
 */
function resolveCategories(
  profile: BenchmarkProfile,
  explicit?: BenchmarkCategory[],
): BenchmarkCategory[] {
  if (explicit && explicit.length > 0) return explicit;

  switch (profile) {
    case 'quick': return ['health'];
    case 'standard': return ['health', 'retrieval'];
    case 'full': return ['health', 'retrieval', 'graph', 'latency'];
  }
}

/**
 * Compute overall score (0-100) from sub-scores.
 */
export function computeOverallScore(
  health: HealthResult,
  retrieval?: RetrievalResult,
  graph?: GraphValueResult,
  latency?: LatencyResult,
): number {
  const scores: Array<{ score: number; weight: number }> = [];

  // Health score (0-100)
  const healthScore = Math.min(100, (
    Math.min(1, health.edgeToChunkRatio / 3) * 30 +
    health.clusterCoverage * 40 +
    (1 - health.orphanChunkPercentage) * 30
  ));
  scores.push({ score: healthScore, weight: 20 });

  // Retrieval score (0-100)
  if (retrieval) {
    const retrievalScore = Math.min(100,
      retrieval.adjacentRecallAt10 * 30 +
      retrieval.bridgingRecallAt10 * 20 +
      retrieval.precisionAt10 * 25 +
      retrieval.tokenEfficiency * 25
    );
    scores.push({ score: retrievalScore, weight: 35 });
  }

  // Graph value score (0-100)
  if (graph) {
    const augScore = Math.min(1, (graph.sourceAttribution.augmentationRatio - 1) / 2);
    const liftScore = Math.min(1, graph.lift);
    const graphScore = Math.min(100, augScore * 50 + liftScore * 50);
    scores.push({ score: graphScore, weight: 30 });
  }

  // Latency score (0-100, based on p95 thresholds)
  if (latency) {
    const recallLatencyScore = latency.recall.p95 <= 50 ? 100
      : latency.recall.p95 <= 100 ? 80
      : latency.recall.p95 <= 200 ? 60
      : latency.recall.p95 <= 500 ? 40
      : 20;
    scores.push({ score: recallLatencyScore, weight: 15 });
  }

  // Weighted average with renormalization
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;

  return Math.round(
    scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight
  );
}

/**
 * Generate human-readable highlights from results.
 */
export function generateHighlights(
  health: HealthResult,
  retrieval?: RetrievalResult,
  graph?: GraphValueResult,
  latency?: LatencyResult,
): string[] {
  const highlights: string[] = [];

  // Health highlights
  highlights.push(`${(health.clusterCoverage * 100).toFixed(0)}% of chunks organized into topic clusters`);

  if (health.orphanChunkPercentage < 0.05) {
    highlights.push(`Only ${(health.orphanChunkPercentage * 100).toFixed(1)}% orphan chunks — knowledge graph is well-connected`);
  }

  if (health.temporalSpan) {
    const days = Math.round(
      (new Date(health.temporalSpan.latest).getTime() - new Date(health.temporalSpan.earliest).getTime()) /
      (1000 * 60 * 60 * 24)
    );
    highlights.push(`Collection spans ${days} days across ${health.projectCount} project(s)`);
  }

  // Retrieval highlights
  if (retrieval) {
    if (retrieval.adjacentRecallAt10 > 0) {
      highlights.push(`Adjacent chunk recall@10: ${(retrieval.adjacentRecallAt10 * 100).toFixed(0)}%`);
    }
    if (retrieval.bridgingRecallAt10 > 0) {
      highlights.push(`Cross-session bridging recall: ${(retrieval.bridgingRecallAt10 * 100).toFixed(0)}%`);
    }
    if (retrieval.tokenEfficiency > 0) {
      highlights.push(`Token efficiency: ${(retrieval.tokenEfficiency * 100).toFixed(0)}% of returned context is relevant`);
    }
  }

  // Graph highlights
  if (graph) {
    if (graph.sourceAttribution.augmentationRatio > 1.1) {
      highlights.push(`Graph traversal adds ${graph.sourceAttribution.augmentationRatio.toFixed(1)}x more results vs vector-only`);
    }
    if (graph.lift > 0.1) {
      highlights.push(`Recall lift from graph: +${(graph.lift * 100).toFixed(0)}% over vector-only`);
    }
  }

  // Latency highlights
  if (latency) {
    highlights.push(`p95 recall latency: ${latency.recall.p95.toFixed(0)}ms`);
  }

  return highlights;
}

/**
 * Run the collection benchmark suite.
 */
export async function runCollectionBenchmark(
  options: CollectionBenchmarkOptions = {},
): Promise<CollectionBenchmarkResult> {
  const {
    profile = 'standard',
    sampleSize = 50,
    seed,
    projectFilter,
    topK = 10,
    includeTuning = true,
    onProgress,
  } = options;

  const categories = resolveCategories(profile, options.categories);

  const skipped: SkippedBenchmark[] = [];
  let retrieval: RetrievalResult | undefined;
  let graphValue: GraphValueResult | undefined;
  let latency: LatencyResult | undefined;

  // 1. Always run health
  onProgress?.('[1/4] Collection health...');
  const includeClusterQuality = categories.includes('retrieval') || categories.includes('graph');
  const health = await runHealthBenchmarks(includeClusterQuality);
  onProgress?.('[1/4] Collection health... done');

  // 2. Generate samples if needed
  let sample;
  if (categories.some(c => c !== 'health')) {
    onProgress?.(`[2/4] Sampling queries (${sampleSize} samples${seed != null ? `, seed=${seed}` : ''})...`);
    sample = generateSamples({ sampleSize, seed, projectFilter });
    onProgress?.('[2/4] Sampling... done');

    // 3. Warm-up
    onProgress?.('[3/4] Warm-up queries...');
    // Warm-up is handled within each benchmark module
    onProgress?.('[3/4] Warm-up... done');
  }

  // 4. Run requested categories
  if (categories.includes('retrieval') && sample) {
    onProgress?.('[4/4] Retrieval quality benchmarks');
    const retrievalResult = await runRetrievalBenchmarks(sample, topK, onProgress);
    retrieval = retrievalResult.result;
    skipped.push(...retrievalResult.skipped);
  }

  if (categories.includes('graph') && sample) {
    onProgress?.('Graph value benchmarks');
    const graphResult = await runGraphValueBenchmarks(sample, topK, onProgress);
    graphValue = graphResult.result;
    skipped.push(...graphResult.skipped);
  }

  if (categories.includes('latency') && sample) {
    onProgress?.('Latency benchmarks');
    const effectiveProject = projectFilter ?? getDistinctProjects()[0]?.slug;
    latency = await runLatencyBenchmarks(sample, effectiveProject, onProgress);
  }

  // Compute composite score
  const overallScore = computeOverallScore(health, retrieval, graphValue, latency);

  // Generate highlights
  const highlights = generateHighlights(health, retrieval, graphValue, latency);

  // Build result
  const result: CollectionBenchmarkResult = {
    timestamp: new Date().toISOString(),
    profile,
    collectionStats: health,
    retrieval,
    graphValue,
    latency,
    overallScore,
    highlights,
    skipped,
  };

  // Tuning recommendations
  if (includeTuning) {
    result.tuning = generateTuningRecommendations(result);
  }

  // Historical trending
  const previousRun = getLatestBenchmarkRun();
  if (previousRun) {
    result.trend = computeTrend(previousRun, result);
  }

  // Store this run
  try {
    const configSnapshot = loadConfig();
    storeBenchmarkRun(result, configSnapshot as unknown as Record<string, unknown>);
  } catch {
    // Non-critical: don't fail benchmark if history storage fails
  }

  return result;
}
