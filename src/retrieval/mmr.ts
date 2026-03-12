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

/** Optional token budget for budget-aware MMR selection. */
export interface MMRBudgetOptions {
  /** Total token budget for selected results. */
  tokenBudget: number;
  /** Token count per chunk ID. */
  chunkTokenCounts: Map<string, number>;
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
 *
 * When `budget` is provided, candidates that would exceed the remaining token
 * budget are excluded from consideration at each step. This prevents large chunks
 * from consuming diversity slots when they can't fit in the response.
 */
export async function reorderWithMMR(
  candidates: RankedItem[],
  queryEmbedding: number[],
  config: MMRConfig,
  budget?: MMRBudgetOptions,
): Promise<RankedItem[]> {
  if (candidates.length < MMR_THRESHOLD) {
    if (!budget) return candidates;
    // Still apply budget filtering even without MMR reranking
    return applyBudgetFilter(candidates, budget);
  }

  const { lambda: baseLambda } = config;

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

  // Budget-adaptive lambda: when few chunks fit the budget, diversity
  // reordering risks pushing relevant results past the cutoff.
  // Estimate available slots and fade diversity as slots shrink.
  const lambda = computeEffectiveLambda(baseLambda, candidates, budget);

  const selected: RankedItem[] = [];
  const selectedEmbeddings: number[][] = [];
  const remaining = new Set(candidates.map((_, i) => i));
  let budgetRemaining = budget?.tokenBudget ?? Infinity;

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const idx of remaining) {
      const c = candidates[idx];

      // Skip candidates that exceed remaining budget
      if (budget) {
        const tokens = budget.chunkTokenCounts.get(c.chunkId) ?? 0;
        if (tokens > budgetRemaining) continue;
      }

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

    // No candidate fits remaining budget
    if (bestIdx === -1) break;

    remaining.delete(bestIdx);
    const picked = candidates[bestIdx];
    selected.push(picked);

    if (budget) {
      budgetRemaining -= budget.chunkTokenCounts.get(picked.chunkId) ?? 0;
    }

    const pickedEmb = embeddings.get(picked.chunkId);
    if (pickedEmb) {
      selectedEmbeddings.push(pickedEmb);
    }
  }

  return selected;
}

/**
 * Estimate available slots and scale lambda toward 1.0 (pure relevance)
 * when budget is tight. With only 5-10 slots, diversity reordering is
 * counterproductive — it pushes relevant results past the budget cutoff.
 *
 * Threshold of 15 slots: below this, lambda ramps from base value to 1.0.
 * At 5 slots: lambda ≈ 0.93 (with base 0.7). At 15+: unchanged.
 */
const SLOT_THRESHOLD = 15;

export function computeEffectiveLambda(
  baseLambda: number,
  candidates: RankedItem[],
  budget?: MMRBudgetOptions,
): number {
  if (!budget) return baseLambda;

  // Estimate median chunk size from the candidates
  const tokenSizes: number[] = [];
  for (const c of candidates) {
    const tokens = budget.chunkTokenCounts.get(c.chunkId);
    if (tokens !== undefined && tokens > 0) tokenSizes.push(tokens);
  }
  if (tokenSizes.length === 0) return baseLambda;

  tokenSizes.sort((a, b) => a - b);
  const median = tokenSizes[Math.floor(tokenSizes.length / 2)];
  const estimatedSlots = budget.tokenBudget / median;

  if (estimatedSlots >= SLOT_THRESHOLD) return baseLambda;

  // Linear ramp: 0 slots → lambda=1.0, SLOT_THRESHOLD slots → baseLambda
  const tightness = Math.max(0, 1 - estimatedSlots / SLOT_THRESHOLD);
  return baseLambda + (1 - baseLambda) * tightness;
}

/** Budget-only filter for below-threshold candidate lists (no MMR reranking). */
function applyBudgetFilter(candidates: RankedItem[], budget: MMRBudgetOptions): RankedItem[] {
  const result: RankedItem[] = [];
  let remaining = budget.tokenBudget;
  for (const c of candidates) {
    const tokens = budget.chunkTokenCounts.get(c.chunkId) ?? 0;
    if (tokens <= remaining) {
      result.push(c);
      remaining -= tokens;
    }
  }
  return result;
}
