/**
 * Benchmark orchestrator.
 *
 * Runs all benchmark categories based on profile, generates samples,
 * computes composite scores, and assembles the final result.
 */

import { generateSamples } from './sampler.js';
import { runHealthBenchmarks } from './health.js';
import { runRetrievalBenchmarks } from './retrieval.js';
import { runChainQualityBenchmarks } from './chain-quality.js';
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
  ChainQualityResult,
  LatencyResult,
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
    case 'quick':
      return ['health'];
    case 'standard':
      return ['health', 'retrieval'];
    case 'full':
      return ['health', 'retrieval', 'chain', 'latency'];
  }
}

/**
 * Compute overall score (0-100) from sub-scores.
 */
export function computeOverallScore(
  health: HealthResult,
  retrieval?: RetrievalResult,
  chain?: ChainQualityResult,
  latency?: LatencyResult,
): number {
  const scores: Array<{ score: number; weight: number }> = [];

  // Health score (0-100)
  const healthScore = Math.min(
    100,
    Math.min(1, health.edgeToChunkRatio / 3) * 30 +
      health.clusterCoverage * 40 +
      (1 - health.orphanChunkPercentage) * 30,
  );
  scores.push({ score: healthScore, weight: 25 });

  // Retrieval score (0-100)
  if (retrieval) {
    const retrievalScore = Math.min(
      100,
      retrieval.adjacentRecallAt10 * 30 +
        retrieval.bridgingRecallAt10 * 20 +
        retrieval.precisionAt10 * 25 +
        retrieval.tokenEfficiency * 25,
    );
    scores.push({ score: retrievalScore, weight: 35 });
  }

  // Chain quality score (0-100)
  if (chain) {
    const coverageScore = chain.chainCoverage * 50;
    const lengthScore = Math.min(1, chain.meanChainLength / 5) * 30;
    const efficiencyScore = Math.min(1, chain.meanScorePerToken * 100) * 20;
    const chainScore = Math.min(100, coverageScore + lengthScore + efficiencyScore);
    scores.push({ score: chainScore, weight: 25 });
  }

  // Latency score (0-100, based on p95 thresholds)
  if (latency) {
    const recallLatencyScore =
      latency.recall.p95 <= 50
        ? 100
        : latency.recall.p95 <= 100
          ? 80
          : latency.recall.p95 <= 200
            ? 60
            : latency.recall.p95 <= 500
              ? 40
              : 20;
    scores.push({ score: recallLatencyScore, weight: 15 });
  }

  // Weighted average with renormalization
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;

  return Math.round(scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight);
}

/**
 * Generate human-readable highlights from results.
 */
export function generateHighlights(
  health: HealthResult,
  retrieval?: RetrievalResult,
  chain?: ChainQualityResult,
  latency?: LatencyResult,
): string[] {
  const highlights: string[] = [];

  // Health highlights
  highlights.push(
    `${(health.clusterCoverage * 100).toFixed(0)}% of chunks organized into topic clusters`,
  );

  if (health.orphanChunkPercentage < 0.05) {
    highlights.push(
      `Only ${(health.orphanChunkPercentage * 100).toFixed(1)}% orphan chunks — knowledge graph is well-connected`,
    );
  }

  if (health.temporalSpan) {
    const days = Math.round(
      (new Date(health.temporalSpan.latest).getTime() -
        new Date(health.temporalSpan.earliest).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    highlights.push(`Collection spans ${days} days across ${health.projectCount} project(s)`);
  }

  // Retrieval highlights
  if (retrieval) {
    if (retrieval.adjacentRecallAt10 > 0) {
      highlights.push(
        `Adjacent chunk recall@10: ${(retrieval.adjacentRecallAt10 * 100).toFixed(0)}%`,
      );
    }
    if (retrieval.bridgingRecallAt10 > 0) {
      highlights.push(
        `Cross-session bridging recall: ${(retrieval.bridgingRecallAt10 * 100).toFixed(0)}%`,
      );
    }
    if (retrieval.tokenEfficiency > 0) {
      highlights.push(
        `Token efficiency: ${(retrieval.tokenEfficiency * 100).toFixed(0)}% of returned context is relevant`,
      );
    }
  }

  // Chain quality highlights
  if (chain) {
    if (chain.chainCoverage > 0) {
      highlights.push(
        `Chain coverage: ${(chain.chainCoverage * 100).toFixed(0)}% of queries produced episodic chains`,
      );
    }
    if (chain.meanChainLength > 0) {
      highlights.push(
        `Mean chain length: ${chain.meanChainLength.toFixed(1)} chunks per narrative`,
      );
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
  let chainQuality: ChainQualityResult | undefined;
  let latency: LatencyResult | undefined;

  // 1. Always run health
  onProgress?.('[1/4] Collection health...');
  const includeClusterQuality = categories.includes('retrieval') || categories.includes('chain');
  const health = await runHealthBenchmarks(includeClusterQuality);
  onProgress?.('[1/4] Collection health... done');

  // 2. Generate samples if needed
  let sample;
  if (categories.some((c) => c !== 'health')) {
    onProgress?.(
      `[2/4] Sampling queries (${sampleSize} samples${seed !== null && seed !== undefined ? `, seed=${seed}` : ''})...`,
    );
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

  if (categories.includes('chain') && sample) {
    onProgress?.('Chain quality benchmarks');
    const chainResult = await runChainQualityBenchmarks(sample, onProgress);
    chainQuality = chainResult.result;
    skipped.push(...chainResult.skipped);
  }

  if (categories.includes('latency') && sample) {
    onProgress?.('Latency benchmarks');
    const effectiveProject = projectFilter ?? getDistinctProjects()[0]?.slug;
    latency = await runLatencyBenchmarks(sample, effectiveProject, onProgress);
  }

  // Compute composite score
  const overallScore = computeOverallScore(health, retrieval, chainQuality, latency);

  // Generate highlights
  const highlights = generateHighlights(health, retrieval, chainQuality, latency);

  // Build result
  const result: CollectionBenchmarkResult = {
    timestamp: new Date().toISOString(),
    profile,
    collectionStats: health,
    retrieval,
    chainQuality,
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
