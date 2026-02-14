/**
 * Chain quality benchmarks.
 *
 * Measures how well the episodic chain-walking pipeline performs:
 * chain length, score per token, chain coverage, and fallback rate.
 */

import { getChunkById } from '../../storage/chunk-store.js';
import { recallContext } from '../../retrieval/chain-assembler.js';
import type { ChainQualityResult, BenchmarkSample, SkippedBenchmark } from './types.js';

/**
 * Run chain quality benchmarks.
 */
export async function runChainQualityBenchmarks(
  sample: BenchmarkSample,
  onProgress?: (msg: string) => void,
): Promise<{ result: ChainQualityResult; skipped: SkippedBenchmark[] }> {
  const skipped: SkippedBenchmark[] = [];

  const queryIds = sample.queryChunkIds.slice(0, Math.min(30, sample.queryChunkIds.length));
  let processed = 0;

  const chainLengths: number[] = [];
  const scoresPerToken: number[] = [];
  let chainCount = 0;
  let fallbackCount = 0;

  for (const chunkId of queryIds) {
    const chunk = getChunkById(chunkId);
    if (!chunk) continue;

    onProgress?.(`[${++processed}/${queryIds.length}] Chain quality analysis...`);

    const response = await recallContext({
      query: chunk.content.slice(0, 500),
      projectFilter: chunk.sessionSlug,
      maxTokens: 10000,
    });

    if (response.mode === 'chain') {
      chainCount++;
      chainLengths.push(response.chainLength);
      if (response.tokenCount > 0) {
        // Compute score-per-token from chain chunks
        const totalWeight = response.chunks.reduce((sum, c) => sum + c.weight, 0);
        scoresPerToken.push(totalWeight / response.tokenCount);
      }
    } else {
      fallbackCount++;
    }
  }

  const totalQueries = chainCount + fallbackCount;
  const meanChainLength =
    chainLengths.length > 0 ? chainLengths.reduce((a, b) => a + b, 0) / chainLengths.length : 0;
  const meanScorePerToken =
    scoresPerToken.length > 0
      ? scoresPerToken.reduce((a, b) => a + b, 0) / scoresPerToken.length
      : 0;

  return {
    result: {
      meanChainLength,
      meanScorePerToken,
      chainCoverage: totalQueries > 0 ? chainCount / totalQueries : 0,
      fallbackRate: totalQueries > 0 ? fallbackCount / totalQueries : 0,
    },
    skipped,
  };
}
