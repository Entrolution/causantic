/**
 * Phase 2: Discrimination test.
 *
 * For each index entry within a cluster, test whether its embedding
 * is more similar to itself than to its cluster siblings.
 *
 * Metric: Mean Reciprocal Rank (MRR) — if we rank cluster entries by
 * similarity to an entry's embedding, what rank does the entry itself get?
 * Perfect discrimination = MRR 1.0 (always rank 1).
 *
 * This tells us: can the search system distinguish between entries in the
 * same topic cluster, or does the compression lose chunk-specific detail?
 */

import { cosineSimilarity } from '../../../utils/angular-distance.js';
import type { ClusterForAnalysis } from './similarity-analysis.js';
import type { DiscriminationResult } from './types.js';

/**
 * Run discrimination test for a single cluster.
 */
export function testClusterDiscrimination(
  cluster: ClusterForAnalysis,
): DiscriminationResult {
  const entries = cluster.entries;
  const perEntry: DiscriminationResult['perEntry'] = [];

  for (let i = 0; i < entries.length; i++) {
    const target = entries[i];

    // Compute similarity of this entry's embedding to all entries' embeddings
    const similarities = entries.map((e, j) => ({
      index: j,
      entryId: e.entryId,
      similarity: cosineSimilarity(target.entryEmbedding, e.entryEmbedding),
    }));

    // Sort descending by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Find rank of the target entry (self-similarity should be 1.0, rank 1)
    // But we want to test the embedding's ability to discriminate,
    // so we use the *chunk* embedding as the query instead of the entry embedding.
    // This simulates: "given the actual chunk content, can we find the right index entry?"
    const queryEmbedding = target.chunkEmbeddings[0];
    if (!queryEmbedding || queryEmbedding.length === 0) {
      perEntry.push({
        entryId: target.entryId,
        rankAmongSiblings: entries.length,
        correctSimilarity: 0,
        bestSiblingSimilarity: 0,
      });
      continue;
    }

    const chunkToEntrySims = entries.map((e, j) => ({
      index: j,
      entryId: e.entryId,
      similarity: cosineSimilarity(queryEmbedding, e.entryEmbedding),
    }));

    chunkToEntrySims.sort((a, b) => b.similarity - a.similarity);

    const rank = chunkToEntrySims.findIndex((s) => s.index === i) + 1;
    const correctSim = chunkToEntrySims.find((s) => s.index === i)!.similarity;
    const bestSiblingSim = chunkToEntrySims.find((s) => s.index !== i)?.similarity ?? 0;

    perEntry.push({
      entryId: target.entryId,
      rankAmongSiblings: rank,
      correctSimilarity: correctSim,
      bestSiblingSimilarity: bestSiblingSim,
    });
  }

  const reciprocalRanks = perEntry.map((e) => 1 / e.rankAmongSiblings);
  const mrr = reciprocalRanks.reduce((a, b) => a + b, 0) / reciprocalRanks.length;
  const hitRate = perEntry.filter((e) => e.rankAmongSiblings === 1).length / perEntry.length;

  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    entryCount: entries.length,
    meanReciprocalRank: mrr,
    hitRate,
    perEntry,
  };
}

/**
 * Run discrimination test across all eligible clusters.
 */
export function runDiscriminationTest(
  clusters: ClusterForAnalysis[],
): DiscriminationResult[] {
  return clusters.map(testClusterDiscrimination);
}
