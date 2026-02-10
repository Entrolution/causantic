/**
 * Retrieval quality benchmarks.
 *
 * Measures whether retrieval returns the right chunks using
 * self-supervised ground truth from structural relationships.
 */

import { getChunkById } from '../../storage/chunk-store.js';
import { assembleContext, type RetrievalRequest } from '../../retrieval/context-assembler.js';
import { approximateTokens } from '../../utils/token-counter.js';
import type {
  RetrievalResult,
  BenchmarkSample,
  SkippedBenchmark,
} from './types.js';

/**
 * Run retrieval quality benchmarks.
 */
export async function runRetrievalBenchmarks(
  sample: BenchmarkSample,
  topK: number,
  onProgress?: (msg: string) => void,
): Promise<{ result: RetrievalResult; skipped: SkippedBenchmark[] }> {
  const skipped: SkippedBenchmark[] = [];

  // Adjacent recall
  let adjacentRecallAt5 = 0;
  let adjacentRecallAt10 = 0;
  let mrrSum = 0;
  let adjacentCount = 0;

  if (sample.thresholds.canRunAdjacentRecall && sample.adjacentPairs.length > 0) {
    let processed = 0;
    for (const pair of sample.adjacentPairs) {
      const queryChunk = getChunkById(pair.queryChunkId);
      if (!queryChunk) continue;

      onProgress?.(`[${++processed}/${sample.adjacentPairs.length}] Adjacent chunk recall...`);

      const response = await assembleContext({
        query: queryChunk.content.slice(0, 500),
        mode: 'recall',
        projectFilter: queryChunk.sessionSlug,
        maxTokens: 10000,
        vectorSearchLimit: topK * 2,
      });

      const resultIds = response.chunks.map(c => c.id);
      const foundInTop5 = resultIds.slice(0, 5).includes(pair.adjacentChunkId);
      const foundInTop10 = resultIds.slice(0, topK).includes(pair.adjacentChunkId);

      if (foundInTop5) adjacentRecallAt5++;
      if (foundInTop10) adjacentRecallAt10++;

      // MRR
      const rank = resultIds.indexOf(pair.adjacentChunkId);
      if (rank >= 0) mrrSum += 1 / (rank + 1);

      adjacentCount++;
    }
  } else {
    const reason = sample.thresholds.reasons.get('adjacentRecall') ?? 'insufficient data';
    skipped.push({
      name: 'Adjacent Chunk Recall',
      reason: `Skipped: ${reason}`,
      threshold: '>=2 sessions with >=3 chunks each',
      current: reason,
    });
  }

  // Cross-session bridging
  let bridgingRecallAt10 = 0;
  let bridgingCount = 0;
  let randomRecallAt10 = 0;
  let randomCount = 0;

  if (sample.thresholds.canRunCrossSessionBridging && sample.crossSessionPairs.length > 0) {
    let processed = 0;
    for (const pair of sample.crossSessionPairs) {
      const queryChunk = getChunkById(pair.chunkIdA);
      if (!queryChunk) continue;

      onProgress?.(`[${++processed}/${sample.crossSessionPairs.length}] Cross-session bridging...`);

      const response = await assembleContext({
        query: queryChunk.content.slice(0, 500),
        mode: 'recall',
        projectFilter: queryChunk.sessionSlug,
        maxTokens: 10000,
        vectorSearchLimit: topK * 2,
      });

      const resultIds = response.chunks.map(c => c.id);
      if (resultIds.slice(0, topK).includes(pair.chunkIdB)) {
        bridgingRecallAt10++;
      }
      bridgingCount++;
    }

    // Random baseline: use cross-project pairs as negative control
    if (sample.crossProjectPairs.length > 0) {
      const randomSample = sample.crossProjectPairs.slice(0, Math.min(20, sample.crossProjectPairs.length));
      for (const pair of randomSample) {
        const queryChunk = getChunkById(pair.chunkIdA);
        if (!queryChunk) continue;

        const response = await assembleContext({
          query: queryChunk.content.slice(0, 500),
          mode: 'recall',
          projectFilter: queryChunk.sessionSlug,
          maxTokens: 10000,
          vectorSearchLimit: topK * 2,
        });

        const resultIds = response.chunks.map(c => c.id);
        if (resultIds.slice(0, topK).includes(pair.chunkIdB)) {
          randomRecallAt10++;
        }
        randomCount++;
      }
    }
  } else {
    const reason = sample.thresholds.reasons.get('crossSessionBridging') ?? 'insufficient data';
    skipped.push({
      name: 'Cross-Session Bridging',
      reason: `Skipped: ${reason}`,
      threshold: '>=3 sessions in same project with cross-session edges',
      current: reason,
    });
  }

  // Precision@K
  let precisionAt5 = 0;
  let precisionAt10 = 0;
  let precisionCount = 0;

  if (sample.thresholds.canRunPrecisionAtK && sample.crossProjectPairs.length > 0) {
    // Use chunk IDs from the first project in cross-project pairs
    const projectASamples = new Map<string, string[]>();
    for (const pair of sample.crossProjectPairs) {
      const list = projectASamples.get(pair.projectA) ?? [];
      list.push(pair.chunkIdA);
      projectASamples.set(pair.projectA, list);
    }

    let processed = 0;
    for (const [project, chunkIds] of projectASamples) {
      const uniqueIds = [...new Set(chunkIds)].slice(0, 10);
      for (const chunkId of uniqueIds) {
        const queryChunk = getChunkById(chunkId);
        if (!queryChunk) continue;

        onProgress?.(`[${++processed}/${Math.min(20, [...projectASamples.values()].flat().length)}] Precision@K...`);

        const response = await assembleContext({
          query: queryChunk.content.slice(0, 500),
          mode: 'recall',
          projectFilter: project,
          maxTokens: 10000,
          vectorSearchLimit: topK * 2,
        });

        const top5FromProject = response.chunks.slice(0, 5).filter(c => c.sessionSlug === project).length;
        const top10FromProject = response.chunks.slice(0, topK).filter(c => c.sessionSlug === project).length;

        precisionAt5 += top5FromProject / Math.min(5, response.chunks.length || 1);
        precisionAt10 += top10FromProject / Math.min(topK, response.chunks.length || 1);
        precisionCount++;
      }
    }
  } else {
    const reason = sample.thresholds.reasons.get('precisionAtK') ?? 'insufficient data';
    skipped.push({
      name: 'Precision@K',
      reason: `Skipped: ${reason}`,
      threshold: '>=2 projects with >=10 chunks each',
      current: reason,
    });
  }

  // Token efficiency
  let tokenEfficiencySum = 0;
  let usefulTokenSum = 0;
  let tokenEfficiencyCount = 0;

  // Reuse adjacent recall results for token efficiency
  if (adjacentCount > 0) {
    for (const pair of sample.adjacentPairs.slice(0, 20)) {
      const queryChunk = getChunkById(pair.queryChunkId);
      if (!queryChunk) continue;

      const response = await assembleContext({
        query: queryChunk.content.slice(0, 500),
        mode: 'recall',
        projectFilter: queryChunk.sessionSlug,
        maxTokens: 10000,
        vectorSearchLimit: topK * 2,
      });

      if (response.chunks.length === 0) continue;

      // Relevant = same session or same project
      const relevantChunks = response.chunks.filter(
        c => c.sessionSlug === queryChunk.sessionSlug
      );

      const totalTokens = response.tokenCount || 1;
      const relevantTokens = relevantChunks.reduce((sum, c) => {
        const chunk = getChunkById(c.id);
        return sum + (chunk?.approxTokens ?? approximateTokens(c.preview));
      }, 0);

      tokenEfficiencySum += relevantTokens / totalTokens;
      usefulTokenSum += relevantTokens;
      tokenEfficiencyCount++;
    }
  }

  const result: RetrievalResult = {
    adjacentRecallAt5: adjacentCount > 0 ? adjacentRecallAt5 / adjacentCount : 0,
    adjacentRecallAt10: adjacentCount > 0 ? adjacentRecallAt10 / adjacentCount : 0,
    mrr: adjacentCount > 0 ? mrrSum / adjacentCount : 0,
    bridgingRecallAt10: bridgingCount > 0 ? bridgingRecallAt10 / bridgingCount : 0,
    bridgingVsRandom: randomCount > 0 && randomRecallAt10 > 0
      ? (bridgingRecallAt10 / bridgingCount) / (randomRecallAt10 / randomCount)
      : bridgingCount > 0 ? bridgingRecallAt10 / bridgingCount : 0,
    precisionAt5: precisionCount > 0 ? precisionAt5 / precisionCount : 0,
    precisionAt10: precisionCount > 0 ? precisionAt10 / precisionCount : 0,
    tokenEfficiency: tokenEfficiencyCount > 0 ? tokenEfficiencySum / tokenEfficiencyCount : 0,
    meanUsefulTokensPerQuery: tokenEfficiencyCount > 0 ? usefulTokenSum / tokenEfficiencyCount : 0,
  };

  return { result, skipped };
}
