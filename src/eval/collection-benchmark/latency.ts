/**
 * Latency & scalability benchmarks.
 *
 * Measures query performance across different retrieval modes
 * with warm-up queries excluded from timing.
 */

import { getChunkById } from '../../storage/chunk-store.js';
import { assembleContext } from '../../retrieval/context-assembler.js';
import { reconstructSession } from '../../retrieval/session-reconstructor.js';
import { loadConfig, toRuntimeConfig } from '../../config/loader.js';
import type { LatencyResult, LatencyPercentiles, BenchmarkSample } from './types.js';

/**
 * Compute percentiles from a sorted array of durations.
 */
export function computePercentiles(durations: number[]): LatencyPercentiles {
  if (durations.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

/**
 * Run latency benchmarks.
 */
export async function runLatencyBenchmarks(
  sample: BenchmarkSample,
  projectSlug: string | undefined,
  onProgress?: (msg: string) => void,
): Promise<LatencyResult> {
  const queryIds = sample.queryChunkIds.slice(0, Math.min(30, sample.queryChunkIds.length));
  const config = toRuntimeConfig(loadConfig());
  const maxTokens = config.mcpMaxResponseTokens;

  // Warm-up: 3 queries, not timed
  onProgress?.('Warm-up queries...');
  for (let i = 0; i < Math.min(3, queryIds.length); i++) {
    const chunk = getChunkById(queryIds[i]);
    if (!chunk) continue;
    await assembleContext({
      query: chunk.content.slice(0, 200),
      mode: 'recall',
      projectFilter: chunk.sessionSlug,
      maxTokens,
    });
  }

  // Recall latency
  const recallDurations: number[] = [];
  let processed = 0;
  for (const chunkId of queryIds) {
    const chunk = getChunkById(chunkId);
    if (!chunk) continue;
    onProgress?.(`[${++processed}/${queryIds.length}] Recall latency...`);

    const start = performance.now();
    await assembleContext({
      query: chunk.content.slice(0, 500),
      mode: 'recall',
      projectFilter: chunk.sessionSlug,
      maxTokens,
    });
    recallDurations.push(performance.now() - start);
  }

  // Search latency
  const searchDurations: number[] = [];
  processed = 0;
  for (const chunkId of queryIds.slice(0, 15)) {
    const chunk = getChunkById(chunkId);
    if (!chunk) continue;
    onProgress?.(`[${++processed}/15] Search latency...`);

    const start = performance.now();
    await assembleContext({
      query: chunk.content.slice(0, 500),
      mode: 'search',
      projectFilter: chunk.sessionSlug,
      maxTokens,
    });
    searchDurations.push(performance.now() - start);
  }

  // Predict latency
  const predictDurations: number[] = [];
  processed = 0;
  for (const chunkId of queryIds.slice(0, 15)) {
    const chunk = getChunkById(chunkId);
    if (!chunk) continue;
    onProgress?.(`[${++processed}/15] Predict latency...`);

    const start = performance.now();
    await assembleContext({
      query: chunk.content.slice(0, 500),
      mode: 'predict',
      projectFilter: chunk.sessionSlug,
      maxTokens,
    });
    predictDurations.push(performance.now() - start);
  }

  // Reconstruct latency
  const reconstructDurations: number[] = [];
  if (projectSlug) {
    processed = 0;
    const limit = Math.min(10, queryIds.length);
    for (let i = 0; i < limit; i++) {
      onProgress?.(`[${++processed}/${limit}] Reconstruct latency...`);
      const start = performance.now();
      reconstructSession({
        project: projectSlug,
        daysBack: 7,
        maxTokens,
      });
      reconstructDurations.push(performance.now() - start);
    }
  }

  return {
    recall: computePercentiles(recallDurations),
    search: computePercentiles(searchDurations),
    predict: computePercentiles(predictDurations),
    reconstruct: computePercentiles(reconstructDurations),
  };
}
