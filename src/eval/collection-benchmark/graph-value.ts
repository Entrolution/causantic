/**
 * Graph value benchmarks.
 *
 * Quantifies what the knowledge graph adds beyond pure vector similarity.
 * Measures source attribution, graph vs vector-only comparison, and
 * edge type effectiveness.
 */

import { getChunkById } from '../../storage/chunk-store.js';
import { getOutgoingEdges, getIncomingEdges } from '../../storage/edge-store.js';
import {
  assembleContext,
  type RetrievalRequest,
  type RetrievalResponse,
} from '../../retrieval/context-assembler.js';
import type {
  GraphValueResult,
  SourceAttribution,
  EdgeTypeEffectiveness,
  BenchmarkSample,
  SkippedBenchmark,
} from './types.js';
import type { ReferenceType } from '../../storage/types.js';

/**
 * Run graph value benchmarks.
 */
export async function runGraphValueBenchmarks(
  sample: BenchmarkSample,
  topK: number,
  onProgress?: (msg: string) => void,
): Promise<{ result: GraphValueResult; skipped: SkippedBenchmark[] }> {
  const skipped: SkippedBenchmark[] = [];

  // Source attribution: run retrieval and count by source
  const sourceCounts = { vector: 0, keyword: 0, cluster: 0, graph: 0 };
  let totalResults = 0;
  let vectorOnlyResults = 0;
  let totalGraphBoosted = 0;

  const queryIds = sample.queryChunkIds.slice(0, Math.min(30, sample.queryChunkIds.length));
  let processed = 0;

  // Full pipeline results + vector-only results for comparison
  const fullResults: RetrievalResponse[] = [];
  const vectorOnlyResponses: RetrievalResponse[] = [];

  for (const chunkId of queryIds) {
    const chunk = getChunkById(chunkId);
    if (!chunk) continue;

    onProgress?.(`[${++processed}/${queryIds.length}] Graph value analysis...`);

    // Full pipeline
    const fullResponse = await assembleContext({
      query: chunk.content.slice(0, 500),
      mode: 'recall',
      projectFilter: chunk.sessionSlug,
      maxTokens: 10000,
      vectorSearchLimit: topK * 2,
    });
    fullResults.push(fullResponse);
    totalGraphBoosted += fullResponse.graphBoosted ?? 0;

    for (const result of fullResponse.chunks) {
      totalResults++;
      const source = result.source ?? 'vector';
      sourceCounts[source]++;
    }

    // Vector-only (skip graph and clusters)
    const vectorOnlyResponse = await assembleContext({
      query: chunk.content.slice(0, 500),
      mode: 'recall',
      projectFilter: chunk.sessionSlug,
      maxTokens: 10000,
      vectorSearchLimit: topK * 2,
      skipGraph: true,
      skipClusters: true,
    } as RetrievalRequest & { skipGraph: boolean; skipClusters: boolean });
    vectorOnlyResponses.push(vectorOnlyResponse);
    vectorOnlyResults += vectorOnlyResponse.chunks.length;
  }

  // Source attribution
  const sourceAttribution: SourceAttribution = {
    vectorPercentage: totalResults > 0 ? sourceCounts.vector / totalResults : 0,
    keywordPercentage: totalResults > 0 ? sourceCounts.keyword / totalResults : 0,
    clusterPercentage: totalResults > 0 ? sourceCounts.cluster / totalResults : 0,
    graphPercentage: totalResults > 0 ? sourceCounts.graph / totalResults : 0,
    augmentationRatio: vectorOnlyResults > 0 ? totalResults / vectorOnlyResults : 1,
  };

  // Graph vs vector-only comparison using adjacent pairs as ground truth
  let fullRecallAt10 = 0;
  let vectorOnlyRecallAt10 = 0;
  let uniqueGraphFinds = 0;
  let comparisonCount = 0;

  if (sample.adjacentPairs.length > 0) {
    // Build a map: queryChunkId -> adjacent pairs
    const adjacentMap = new Map<string, string[]>();
    for (const pair of sample.adjacentPairs) {
      const list = adjacentMap.get(pair.queryChunkId) ?? [];
      list.push(pair.adjacentChunkId);
      adjacentMap.set(pair.queryChunkId, list);
    }

    for (let i = 0; i < queryIds.length; i++) {
      const chunkId = queryIds[i];
      const adjacents = adjacentMap.get(chunkId);
      if (!adjacents || adjacents.length === 0) continue;

      const fullResultIds = new Set(fullResults[i]?.chunks.slice(0, topK).map(c => c.id) ?? []);
      const vectorOnlyIds = new Set(vectorOnlyResponses[i]?.chunks.slice(0, topK).map(c => c.id) ?? []);

      for (const adjId of adjacents) {
        if (fullResultIds.has(adjId)) fullRecallAt10++;
        if (vectorOnlyIds.has(adjId)) vectorOnlyRecallAt10++;
        if (fullResultIds.has(adjId) && !vectorOnlyIds.has(adjId)) uniqueGraphFinds++;
        comparisonCount++;
      }
    }
  }

  const normalizedFullRecall = comparisonCount > 0 ? fullRecallAt10 / comparisonCount : 0;
  const normalizedVectorOnlyRecall = comparisonCount > 0 ? vectorOnlyRecallAt10 / comparisonCount : 0;
  const lift = normalizedVectorOnlyRecall > 0
    ? (normalizedFullRecall - normalizedVectorOnlyRecall) / normalizedVectorOnlyRecall
    : normalizedFullRecall > 0 ? 1 : 0;

  // Edge type effectiveness
  const edgeTypeEffectiveness: EdgeTypeEffectiveness[] = [];
  const edgeTypeSurfaced = new Map<string, number>();
  const edgeTypeRecallHits = new Map<string, number>();

  // Count graph-sourced results by examining response metadata
  for (const response of fullResults) {
    for (const chunk of response.chunks) {
      if (chunk.source === 'graph') {
        // We can't directly track which edge type led to this result
        // without additional instrumentation, so we approximate by
        // looking at what edge types exist for this chunk
        const edgeTypes = getEdgeTypesForChunk(chunk.id);
        for (const type of edgeTypes) {
          edgeTypeSurfaced.set(type, (edgeTypeSurfaced.get(type) ?? 0) + 1);
        }
      }
    }
  }

  const allEdgeTypes: ReferenceType[] = [
    'file-path', 'code-entity', 'explicit-backref', 'error-fragment',
    'tool-output', 'adjacent', 'cross-session', 'brief', 'debrief',
  ];

  for (const type of allEdgeTypes) {
    const surfaced = edgeTypeSurfaced.get(type) ?? 0;
    if (surfaced > 0) {
      edgeTypeEffectiveness.push({
        type,
        chunksSurfaced: surfaced,
        recallContribution: totalResults > 0 ? surfaced / totalResults : 0,
      });
    }
  }

  edgeTypeEffectiveness.sort((a, b) => b.chunksSurfaced - a.chunksSurfaced);

  return {
    result: {
      sourceAttribution,
      fullRecallAt10: normalizedFullRecall,
      vectorOnlyRecallAt10: normalizedVectorOnlyRecall,
      uniqueGraphFinds,
      graphBoostedCount: totalGraphBoosted,
      lift,
      edgeTypeEffectiveness,
    },
    skipped,
  };
}

/**
 * Get the reference types of edges connected to a chunk.
 */
function getEdgeTypesForChunk(chunkId: string): string[] {
  const outgoing = getOutgoingEdges(chunkId);
  const incoming = getIncomingEdges(chunkId);
  const types = new Set<string>();
  for (const edge of [...outgoing, ...incoming]) {
    if (edge.referenceType) types.add(edge.referenceType);
  }
  return [...types];
}
