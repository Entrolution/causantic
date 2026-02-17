/**
 * Maximal Marginal Relevance (MMR) reranking for diversity-aware search results.
 *
 * Reorders candidates using the formula:
 *   MMR(c) = lambda * relevance(c) - (1 - lambda) * max_similarity(c, Selected)
 *
 * This balances relevance with novelty: as selected items saturate a semantic
 * neighbourhood, candidates from different topics become competitive.
 */

import { vectorStore } from '../storage/vector-store.js';
import { cosineSimilarity } from '../utils/angular-distance.js';
import type { RankedItem } from './rrf.js';

export interface MMRConfig {
  /** 0 = pure diversity, 1 = pure relevance. Default: 0.7 */
  lambda: number;
}

/** Minimum candidate count to trigger MMR. Below this, diversity doesn't matter. */
const MMR_THRESHOLD = 10;

/**
 * Reorder candidates using Maximal Marginal Relevance.
 *
 * First pick is always the top relevance hit (diversity = 0 when nothing selected).
 * Subsequent picks balance relevance against redundancy with already-selected items.
 *
 * Short-circuits when fewer than 10 candidates (too few for diversity to matter).
 * Candidates without embeddings are treated as novel (diversity = 0).
 * Original RRF scores are preserved — only order changes.
 */
export async function reorderWithMMR(
  candidates: RankedItem[],
  queryEmbedding: number[],
  config: MMRConfig,
): Promise<RankedItem[]> {
  if (candidates.length < MMR_THRESHOLD) {
    return candidates;
  }

  const { lambda } = config;

  // Fetch embeddings for all candidates
  const embeddings = new Map<string, number[]>();
  for (const c of candidates) {
    const emb = await vectorStore.get(c.chunkId);
    if (emb) {
      embeddings.set(c.chunkId, emb);
    }
  }

  // Normalize scores to [0,1] — candidates are pre-sorted by score descending
  const maxScore = candidates[0].score;
  const normalizedScores = new Map<string, number>();
  for (const c of candidates) {
    normalizedScores.set(c.chunkId, maxScore > 0 ? c.score / maxScore : 0);
  }

  const selected: RankedItem[] = [];
  const selectedEmbeddings: number[][] = [];
  const remaining = new Set(candidates.map((_, i) => i));

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const idx of remaining) {
      const c = candidates[idx];
      const rel = normalizedScores.get(c.chunkId)!;

      // Compute max similarity to already-selected items
      let div = 0;
      const cEmb = embeddings.get(c.chunkId);
      if (cEmb && selectedEmbeddings.length > 0) {
        for (const sEmb of selectedEmbeddings) {
          const sim = cosineSimilarity(cEmb, sEmb);
          if (sim > div) div = sim;
        }
      }
      // No embedding → div stays 0 (assume novel)

      const mmr = lambda * rel - (1 - lambda) * div;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = idx;
      }
    }

    remaining.delete(bestIdx);
    const picked = candidates[bestIdx];
    selected.push(picked);

    const pickedEmb = embeddings.get(picked.chunkId);
    if (pickedEmb) {
      selectedEmbeddings.push(pickedEmb);
    }
  }

  return selected;
}
