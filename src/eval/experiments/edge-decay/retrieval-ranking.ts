/**
 * Retrieval ranking experiment for edge decay validation.
 *
 * Tests whether decay-weighted ranking of candidate turns
 * correlates with actual turn-to-turn references.
 *
 * Distance metric: hop distance (turn count difference).
 */

import type { DecayModelConfig } from './types.js';
import { calculateWeight } from './decay-curves.js';
import type {
  SessionReferences,
  TurnReference,
  CandidateTurn,
  QueryEvaluation,
  RetrievalRankingResult,
  HopDistanceBin,
  HopDistanceCorrelationResult,
} from './reference-types.js';

/**
 * Options for filtering references to focus on long-range retrieval.
 */
export interface ReferenceFilterOptions {
  /** Minimum turn distance to include (e.g., 2 = skip immediately previous) */
  minTurnDistance?: number;
  /** Exclude 'adjacent' reference type (low confidence recency) */
  excludeAdjacent?: boolean;
  /** Only include high confidence references */
  highConfidenceOnly?: boolean;
}

/**
 * Filter references to focus on long-range retrieval scenarios.
 * This simulates what the memory system actually needs to retrieve —
 * context that's NOT in Claude's immediate context window.
 */
export function filterLongRangeReferences(
  sessions: SessionReferences[],
  options: ReferenceFilterOptions = {},
): SessionReferences[] {
  const { minTurnDistance = 1, excludeAdjacent = false, highConfidenceOnly = false } = options;

  return sessions.map((session) => {
    const filteredRefs = session.references.filter((ref) => {
      // Check turn distance (= hop distance)
      if (ref.hopDistance < minTurnDistance) return false;

      // Exclude adjacent type if requested
      if (excludeAdjacent && ref.referenceType === 'adjacent') return false;

      // High confidence only
      if (highConfidenceOnly && ref.confidence !== 'high') return false;

      return true;
    });

    return {
      ...session,
      references: filteredRefs,
    };
  });
}

/**
 * Build a map from query turn to its referenced turns.
 */
function buildReferenceMap(references: TurnReference[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();

  for (const ref of references) {
    if (!map.has(ref.userTurnIndex)) {
      map.set(ref.userTurnIndex, new Set());
    }
    map.get(ref.userTurnIndex)!.add(ref.referencedTurnIndex);
  }

  return map;
}

/**
 * Evaluate a single query turn against all candidates using a decay model.
 * Distance metric: hop distance (queryTurnIndex - candidateTurnIndex).
 */
function evaluateQuery(
  queryTurnIndex: number,
  candidateTurnIndices: number[],
  relevantTurns: Set<number>,
  decayModel: DecayModelConfig,
): QueryEvaluation {
  // Score each candidate by hop distance
  const candidates: CandidateTurn[] = candidateTurnIndices.map((turnIndex) => {
    const hopDistance = queryTurnIndex - turnIndex;
    const decayWeight = calculateWeight(decayModel, hopDistance);
    const isRelevant = relevantTurns.has(turnIndex);

    return {
      turnIndex,
      hopDistance,
      decayWeight,
      isRelevant,
    };
  });

  // Sort by decay weight (descending)
  candidates.sort((a, b) => b.decayWeight - a.decayWeight);

  // Find rank of first relevant turn
  let firstRelevantRank = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].isRelevant) {
      firstRelevantRank = i + 1; // 1-indexed rank
      break;
    }
  }

  const reciprocalRank = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;

  return {
    queryTurnIndex,
    relevantTurns: [...relevantTurns],
    rankedCandidates: candidates,
    reciprocalRank,
    firstRelevantRank,
  };
}

/**
 * Run retrieval ranking experiment for a single decay model.
 */
export function evaluateRetrievalRanking(
  sessions: SessionReferences[],
  decayModel: DecayModelConfig,
): RetrievalRankingResult {
  const evaluations: QueryEvaluation[] = [];
  let totalRR = 0;
  let queriesWithRelevant = 0;
  const rankDistribution = {
    rank1: 0,
    rank2_5: 0,
    rank6_10: 0,
    rank11_plus: 0,
  };

  for (const session of sessions) {
    const referenceMap = buildReferenceMap(session.references);

    // For each query turn that has references
    for (const [queryTurnIndex, relevantTurns] of referenceMap) {
      // Skip if no relevant turns
      if (relevantTurns.size === 0) continue;

      // Candidates are all turns before the query
      const candidateTurnIndices = Array.from({ length: queryTurnIndex }, (_, i) => i);

      if (candidateTurnIndices.length === 0) continue;

      const evaluation = evaluateQuery(
        queryTurnIndex,
        candidateTurnIndices,
        relevantTurns,
        decayModel,
      );

      evaluations.push(evaluation);
      totalRR += evaluation.reciprocalRank;

      if (evaluation.firstRelevantRank > 0) {
        queriesWithRelevant++;

        if (evaluation.firstRelevantRank === 1) {
          rankDistribution.rank1++;
        } else if (evaluation.firstRelevantRank <= 5) {
          rankDistribution.rank2_5++;
        } else if (evaluation.firstRelevantRank <= 10) {
          rankDistribution.rank6_10++;
        } else {
          rankDistribution.rank11_plus++;
        }
      }
    }
  }

  const mrr = evaluations.length > 0 ? totalRR / evaluations.length : 0;

  return {
    modelId: decayModel.id,
    modelName: decayModel.name,
    mrr,
    queryCount: evaluations.length,
    queriesWithRelevant,
    rankDistribution,
    evaluations,
  };
}

/**
 * Run retrieval ranking experiment for multiple decay models.
 */
export function compareRetrievalRanking(
  sessions: SessionReferences[],
  decayModels: DecayModelConfig[],
  verbose: boolean = true,
): RetrievalRankingResult[] {
  const results: RetrievalRankingResult[] = [];

  for (const model of decayModels) {
    if (verbose) {
      console.log(`  Evaluating ${model.name}...`);
    }

    const result = evaluateRetrievalRanking(sessions, model);
    results.push(result);

    if (verbose) {
      console.log(`    MRR: ${result.mrr.toFixed(3)}, Queries: ${result.queryCount}`);
    }
  }

  return results;
}

/**
 * Hop-distance bins for correlation analysis.
 */
const HOP_DISTANCE_BINS: Array<{ label: string; minHops: number; maxHops: number }> = [
  { label: '1 hop', minHops: 1, maxHops: 2 },
  { label: '2-3 hops', minHops: 2, maxHops: 4 },
  { label: '4-6 hops', minHops: 4, maxHops: 7 },
  { label: '7-10 hops', minHops: 7, maxHops: 11 },
  { label: '11-20 hops', minHops: 11, maxHops: 21 },
  { label: '21+ hops', minHops: 21, maxHops: Infinity },
];

/**
 * Compute Spearman rank correlation between two arrays.
 */
function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;

  // Compute ranks
  const rankX = computeRanks(x);
  const rankY = computeRanks(y);

  // Compute d^2
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumD2 += d * d;
  }

  // Spearman formula: 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/**
 * Compute ranks for an array of values.
 */
function computeRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; i++) {
    ranks[indexed[i].index] = i + 1;
  }

  return ranks;
}

/**
 * Run hop-distance correlation experiment.
 */
export function evaluateHopDistanceCorrelation(
  sessions: SessionReferences[],
  decayModels: DecayModelConfig[],
): HopDistanceCorrelationResult {
  // Initialize bins
  const bins: HopDistanceBin[] = HOP_DISTANCE_BINS.map((b) => ({
    ...b,
    pairCount: 0,
    referenceRate: 0,
    meanDecayWeights: {},
  }));

  // For each model, accumulate decay weights per bin
  const decayWeightSums: Record<string, number[]> = {};
  for (const model of decayModels) {
    decayWeightSums[model.id] = bins.map(() => 0);
  }

  // Count references and total possible pairs in each bin
  const referenceCounts = bins.map(() => 0);
  const pairCounts = bins.map(() => 0);

  // Count all possible turn pairs at each hop distance.
  // A session with N turns has (N - d) pairs at distance d
  // (each user turn i can reference assistant turn i-d).
  for (const session of sessions) {
    for (let d = 1; d < session.turnCount; d++) {
      const binIndex = bins.findIndex((b) => d >= b.minHops && d < b.maxHops);
      if (binIndex >= 0) {
        // Number of pairs at this exact distance in this session
        pairCounts[binIndex] += session.turnCount - d;

        // Accumulate decay weights for all possible pairs at this distance
        for (const model of decayModels) {
          const weight = calculateWeight(model, d);
          decayWeightSums[model.id][binIndex] += weight * (session.turnCount - d);
        }
      }
    }
  }

  // Count actual references per bin
  for (const session of sessions) {
    for (const ref of session.references) {
      const binIndex = bins.findIndex(
        (b) => ref.hopDistance >= b.minHops && ref.hopDistance < b.maxHops,
      );
      if (binIndex >= 0) {
        referenceCounts[binIndex]++;
      }
    }
  }

  // Compute mean decay weights and reference rates
  for (let i = 0; i < bins.length; i++) {
    bins[i].pairCount = pairCounts[i];
    bins[i].referenceRate = pairCounts[i] > 0 ? referenceCounts[i] / pairCounts[i] : 0;

    for (const model of decayModels) {
      bins[i].meanDecayWeights[model.id] =
        pairCounts[i] > 0 ? decayWeightSums[model.id][i] / pairCounts[i] : 0;
    }
  }

  // Compute correlations
  const correlations: Record<string, number> = {};
  const referenceRates = bins.map((b) => b.referenceRate);

  for (const model of decayModels) {
    const decayWeights = bins.map((b) => b.meanDecayWeights[model.id]);
    correlations[model.id] = spearmanCorrelation(referenceRates, decayWeights);
  }

  return { bins, correlations };
}

/**
 * Format retrieval ranking results as a comparison table.
 */
export function formatRetrievalRankingTable(results: RetrievalRankingResult[]): string {
  const lines: string[] = [];

  // Header
  lines.push('='.repeat(90));
  lines.push('  RETRIEVAL RANKING COMPARISON (Mean Reciprocal Rank)');
  lines.push('='.repeat(90));

  const header = [
    'Model'.padEnd(25),
    'MRR'.padEnd(10),
    'Queries'.padEnd(10),
    'Rank@1'.padEnd(10),
    'Rank@2-5'.padEnd(10),
    'Rank@6-10'.padEnd(10),
    'Rank@11+'.padEnd(10),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(90));

  // Sort by MRR descending
  const sorted = [...results].sort((a, b) => b.mrr - a.mrr);

  for (const result of sorted) {
    const row = [
      result.modelName.slice(0, 25).padEnd(25),
      result.mrr.toFixed(3).padEnd(10),
      result.queryCount.toString().padEnd(10),
      result.rankDistribution.rank1.toString().padEnd(10),
      result.rankDistribution.rank2_5.toString().padEnd(10),
      result.rankDistribution.rank6_10.toString().padEnd(10),
      result.rankDistribution.rank11_plus.toString().padEnd(10),
    ].join(' | ');

    lines.push(row);
  }

  lines.push('='.repeat(90));

  return lines.join('\n');
}

/**
 * Format hop-distance correlation results.
 */
export function formatHopDistanceTable(
  result: HopDistanceCorrelationResult,
  decayModels: DecayModelConfig[],
): string {
  const lines: string[] = [];

  lines.push('='.repeat(100));
  lines.push('  HOP-DISTANCE CORRELATION');
  lines.push('='.repeat(100));

  // Header
  const modelHeaders = decayModels.map((m) => m.name.slice(0, 12).padEnd(12)).join(' | ');
  const header = `${'Hops'.padEnd(12)} | ${'Pairs'.padEnd(8)} | ${'Ref Rate'.padEnd(8)} | ${modelHeaders}`;
  lines.push(header);
  lines.push('-'.repeat(100));

  // Rows
  for (const bin of result.bins) {
    const weights = decayModels
      .map((m) => bin.meanDecayWeights[m.id].toFixed(3).padEnd(12))
      .join(' | ');

    const row = [
      bin.label.padEnd(12),
      bin.pairCount.toString().padEnd(8),
      bin.referenceRate.toFixed(3).padEnd(8),
      weights,
    ].join(' | ');

    lines.push(row);
  }

  lines.push('-'.repeat(100));

  // Correlations
  const corrValues = decayModels
    .map((m) => result.correlations[m.id].toFixed(3).padEnd(12))
    .join(' | ');

  lines.push(`${'Correlation'.padEnd(12)} | ${''.padEnd(8)} | ${''.padEnd(8)} | ${corrValues}`);
  lines.push('='.repeat(100));

  return lines.join('\n');
}

// ============================================================
// FORWARD QUERY EVALUATION
// ============================================================
//
// Forward queries ask: "Given this turn, which FUTURE turns will reference it?"
// This is a prediction task - we don't know what's coming.
// Hypothesis: Exponential decay better models prediction uncertainty.

/**
 * Build a map from source turn to future turns that reference it.
 * This is the reverse of the backward reference map.
 *
 * Backward: userTurnIndex → referencedTurnIndex (what past turns did I reference?)
 * Forward: referencedTurnIndex → userTurnIndex (what future turns will reference me?)
 */
function buildForwardReferenceMap(references: TurnReference[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();

  for (const ref of references) {
    // Key is the referenced turn (source), value is set of future turns that reference it
    if (!map.has(ref.referencedTurnIndex)) {
      map.set(ref.referencedTurnIndex, new Set());
    }
    map.get(ref.referencedTurnIndex)!.add(ref.userTurnIndex);
  }

  return map;
}

/**
 * Evaluate forward prediction for a single source turn.
 * Given turn T, predict which future turns will reference it.
 * Distance metric: hop distance (futureTurnIndex - sourceTurnIndex).
 */
function evaluateForwardQuery(
  sourceTurnIndex: number,
  candidateFutureTurns: number[],
  actualReferencingTurns: Set<number>,
  decayModel: DecayModelConfig,
): QueryEvaluation {
  // Score each candidate future turn by hop distance
  const candidates: CandidateTurn[] = candidateFutureTurns.map((futureTurnIndex) => {
    const hopDistance = futureTurnIndex - sourceTurnIndex;
    const decayWeight = calculateWeight(decayModel, hopDistance);
    const isRelevant = actualReferencingTurns.has(futureTurnIndex);

    return {
      turnIndex: futureTurnIndex,
      hopDistance,
      decayWeight,
      isRelevant,
    };
  });

  // Sort by decay weight (descending) - higher weight = more likely to reference
  candidates.sort((a, b) => b.decayWeight - a.decayWeight);

  // Find rank of first relevant (actually referencing) turn
  let firstRelevantRank = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].isRelevant) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  const reciprocalRank = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;

  return {
    queryTurnIndex: sourceTurnIndex,
    relevantTurns: [...actualReferencingTurns],
    rankedCandidates: candidates,
    reciprocalRank,
    firstRelevantRank,
  };
}

/**
 * Run forward prediction experiment for a single decay model.
 *
 * For each turn that gets referenced by future turns:
 * - Predict which future turns will reference it (using decay weights)
 * - Measure if actual referencing turns rank highly
 */
export function evaluateForwardPrediction(
  sessions: SessionReferences[],
  decayModel: DecayModelConfig,
  minHopDistance: number = 1,
): RetrievalRankingResult {
  const evaluations: QueryEvaluation[] = [];
  let totalRR = 0;
  let queriesWithRelevant = 0;
  const rankDistribution = {
    rank1: 0,
    rank2_5: 0,
    rank6_10: 0,
    rank11_plus: 0,
  };

  for (const session of sessions) {
    // Filter references to only include those at or beyond minHopDistance
    const filteredRefs = session.references.filter((ref) => ref.hopDistance >= minHopDistance);
    const forwardMap = buildForwardReferenceMap(filteredRefs);

    // For each source turn that has future references beyond the min distance
    for (const [sourceTurnIndex, referencingTurns] of forwardMap) {
      if (referencingTurns.size === 0) continue;

      // Candidates are turns at or beyond minHopDistance from source
      const candidateFutureTurns = Array.from(
        { length: session.turnCount - sourceTurnIndex - minHopDistance },
        (_, i) => sourceTurnIndex + minHopDistance + i,
      );

      if (candidateFutureTurns.length === 0) continue;

      const evaluation = evaluateForwardQuery(
        sourceTurnIndex,
        candidateFutureTurns,
        referencingTurns,
        decayModel,
      );

      evaluations.push(evaluation);
      totalRR += evaluation.reciprocalRank;

      if (evaluation.firstRelevantRank > 0) {
        queriesWithRelevant++;

        if (evaluation.firstRelevantRank === 1) {
          rankDistribution.rank1++;
        } else if (evaluation.firstRelevantRank <= 5) {
          rankDistribution.rank2_5++;
        } else if (evaluation.firstRelevantRank <= 10) {
          rankDistribution.rank6_10++;
        } else {
          rankDistribution.rank11_plus++;
        }
      }
    }
  }

  const mrr = evaluations.length > 0 ? totalRR / evaluations.length : 0;

  return {
    modelId: decayModel.id,
    modelName: decayModel.name,
    mrr,
    queryCount: evaluations.length,
    queriesWithRelevant,
    rankDistribution,
    evaluations,
  };
}

/**
 * Run forward prediction experiment for multiple decay models.
 */
export function compareForwardPrediction(
  sessions: SessionReferences[],
  decayModels: DecayModelConfig[],
  verbose: boolean = true,
): RetrievalRankingResult[] {
  const results: RetrievalRankingResult[] = [];

  for (const model of decayModels) {
    if (verbose) {
      console.log(`  Evaluating ${model.name}...`);
    }

    const result = evaluateForwardPrediction(sessions, model);
    results.push(result);

    if (verbose) {
      console.log(`    MRR: ${result.mrr.toFixed(3)}, Queries: ${result.queryCount}`);
    }
  }

  return results;
}

/**
 * Format comparison of backward vs forward results.
 */
export function formatDirectionalComparison(
  backwardResults: RetrievalRankingResult[],
  forwardResults: RetrievalRankingResult[],
): string {
  const lines: string[] = [];

  lines.push('='.repeat(100));
  lines.push('  DIRECTIONAL COMPARISON: Backward (Retrieval) vs Forward (Prediction)');
  lines.push('='.repeat(100));

  const header = [
    'Model'.padEnd(25),
    'Backward MRR'.padEnd(14),
    'Forward MRR'.padEnd(14),
    'Δ'.padEnd(10),
    'Better For'.padEnd(15),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(100));

  // Match results by model ID
  for (const backward of backwardResults) {
    const forward = forwardResults.find((f) => f.modelId === backward.modelId);
    if (!forward) continue;

    const delta = forward.mrr - backward.mrr;
    const betterFor = delta > 0.01 ? 'Forward' : delta < -0.01 ? 'Backward' : 'Similar';

    const row = [
      backward.modelName.slice(0, 25).padEnd(25),
      backward.mrr.toFixed(3).padEnd(14),
      forward.mrr.toFixed(3).padEnd(14),
      (delta >= 0 ? '+' : '') + delta.toFixed(3).padEnd(9),
      betterFor.padEnd(15),
    ].join(' | ');

    lines.push(row);
  }

  lines.push('='.repeat(100));

  return lines.join('\n');
}
