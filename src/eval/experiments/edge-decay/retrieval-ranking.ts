/**
 * Retrieval ranking experiment for edge decay validation.
 *
 * Tests whether decay-weighted ranking of candidate turns
 * correlates with actual turn-to-turn references.
 */

import type { DecayModelConfig } from './types.js';
import { calculateWeight } from './decay-curves.js';
import type {
  SessionReferences,
  TurnReference,
  CandidateTurn,
  QueryEvaluation,
  RetrievalRankingResult,
  TimeOffsetBin,
  TimeOffsetCorrelationResult,
} from './reference-types.js';

import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from './types.js';

/**
 * Options for filtering references to focus on long-range retrieval.
 */
export interface ReferenceFilterOptions {
  /** Minimum turn distance to include (e.g., 2 = skip immediately previous) */
  minTurnDistance?: number;
  /** Minimum time gap in ms to include (e.g., 5 * MS_PER_MINUTE) */
  minTimeGapMs?: number;
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
  const {
    minTurnDistance = 1,
    minTimeGapMs = 0,
    excludeAdjacent = false,
    highConfidenceOnly = false,
  } = options;

  return sessions.map(session => {
    const filteredRefs = session.references.filter(ref => {
      // Check turn distance
      const turnDistance = ref.userTurnIndex - ref.referencedTurnIndex;
      if (turnDistance < minTurnDistance) return false;

      // Check time gap
      if (ref.timeGapMs < minTimeGapMs) return false;

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
function buildReferenceMap(
  references: TurnReference[],
): Map<number, Set<number>> {
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
 * Build a map from query turn to time gaps for each candidate.
 */
function buildTimeGapMap(
  references: TurnReference[],
  turnCount: number,
): Map<number, Map<number, number>> {
  const map = new Map<number, Map<number, number>>();

  // Initialize from explicit references
  for (const ref of references) {
    if (!map.has(ref.userTurnIndex)) {
      map.set(ref.userTurnIndex, new Map());
    }
    map.get(ref.userTurnIndex)!.set(ref.referencedTurnIndex, ref.timeGapMs);
  }

  return map;
}

/**
 * Evaluate a single query turn against all candidates using a decay model.
 */
function evaluateQuery(
  queryTurnIndex: number,
  candidateTurnIndices: number[],
  relevantTurns: Set<number>,
  timeGaps: Map<number, number>,
  decayModel: DecayModelConfig,
): QueryEvaluation {
  // Score each candidate
  const candidates: CandidateTurn[] = candidateTurnIndices.map(turnIndex => {
    const timeGapMs = timeGaps.get(turnIndex) ?? 0;
    const decayWeight = calculateWeight(decayModel, timeGapMs);
    const isRelevant = relevantTurns.has(turnIndex);

    return {
      turnIndex,
      timeGapMs,
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
    const timeGapMap = buildTimeGapMap(session.references, session.turnCount);

    // For each query turn that has references
    for (const [queryTurnIndex, relevantTurns] of referenceMap) {
      // Skip if no relevant turns
      if (relevantTurns.size === 0) continue;

      // Candidates are all turns before the query
      const candidateTurnIndices = Array.from(
        { length: queryTurnIndex },
        (_, i) => i
      );

      if (candidateTurnIndices.length === 0) continue;

      // Get time gaps for this query
      const timeGaps = timeGapMap.get(queryTurnIndex) ?? new Map();

      // For candidates without explicit time gaps, estimate from reference data
      // (This shouldn't happen often since we extract time gaps during reference extraction)
      for (const candidateIdx of candidateTurnIndices) {
        if (!timeGaps.has(candidateIdx)) {
          // Find a reference with known time gap to estimate
          const knownRef = session.references.find(
            r => r.userTurnIndex === queryTurnIndex && r.referencedTurnIndex !== candidateIdx
          );
          if (knownRef) {
            // Estimate based on turn distance ratio
            const refTurnDist = queryTurnIndex - knownRef.referencedTurnIndex;
            const thisTurnDist = queryTurnIndex - candidateIdx;
            const estimatedGap = (knownRef.timeGapMs / refTurnDist) * thisTurnDist;
            timeGaps.set(candidateIdx, estimatedGap);
          } else {
            // Default to 5 minutes per turn distance
            timeGaps.set(candidateIdx, (queryTurnIndex - candidateIdx) * 5 * MS_PER_MINUTE);
          }
        }
      }

      const evaluation = evaluateQuery(
        queryTurnIndex,
        candidateTurnIndices,
        relevantTurns,
        timeGaps,
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
 * Time offset bins for correlation analysis.
 */
const TIME_OFFSET_BINS: Array<{ label: string; minMs: number; maxMs: number }> = [
  { label: '0-5min', minMs: 0, maxMs: 5 * MS_PER_MINUTE },
  { label: '5-30min', minMs: 5 * MS_PER_MINUTE, maxMs: 30 * MS_PER_MINUTE },
  { label: '30min-1h', minMs: 30 * MS_PER_MINUTE, maxMs: MS_PER_HOUR },
  { label: '1-4h', minMs: MS_PER_HOUR, maxMs: 4 * MS_PER_HOUR },
  { label: '4-24h', minMs: 4 * MS_PER_HOUR, maxMs: MS_PER_DAY },
  { label: '1-7d', minMs: MS_PER_DAY, maxMs: 7 * MS_PER_DAY },
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
 * Run time-offset correlation experiment.
 */
export function evaluateTimeOffsetCorrelation(
  sessions: SessionReferences[],
  decayModels: DecayModelConfig[],
): TimeOffsetCorrelationResult {
  // Initialize bins
  const bins: TimeOffsetBin[] = TIME_OFFSET_BINS.map(b => ({
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

  // Count references in each bin
  const referenceCounts = bins.map(() => 0);
  const pairCounts = bins.map(() => 0);

  // Process all references
  for (const session of sessions) {
    for (const ref of session.references) {
      // Find which bin this reference falls into
      const binIndex = bins.findIndex(
        b => ref.timeGapMs >= b.minMs && ref.timeGapMs < b.maxMs
      );

      if (binIndex >= 0) {
        referenceCounts[binIndex]++;
        pairCounts[binIndex]++;

        // Accumulate decay weights
        for (const model of decayModels) {
          const weight = calculateWeight(model, ref.timeGapMs);
          decayWeightSums[model.id][binIndex] += weight;
        }
      }
    }
  }

  // Compute mean decay weights and reference rates
  for (let i = 0; i < bins.length; i++) {
    bins[i].pairCount = pairCounts[i];
    bins[i].referenceRate = pairCounts[i] > 0 ? referenceCounts[i] / pairCounts[i] : 0;

    for (const model of decayModels) {
      bins[i].meanDecayWeights[model.id] = pairCounts[i] > 0
        ? decayWeightSums[model.id][i] / pairCounts[i]
        : 0;
    }
  }

  // Compute correlations
  const correlations: Record<string, number> = {};
  const referenceRates = bins.map(b => b.referenceRate);

  for (const model of decayModels) {
    const decayWeights = bins.map(b => b.meanDecayWeights[model.id]);
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
 * Format time-offset correlation results.
 */
export function formatTimeOffsetTable(
  result: TimeOffsetCorrelationResult,
  decayModels: DecayModelConfig[],
): string {
  const lines: string[] = [];

  lines.push('='.repeat(100));
  lines.push('  TIME-OFFSET CORRELATION');
  lines.push('='.repeat(100));

  // Header
  const modelHeaders = decayModels.map(m => m.name.slice(0, 12).padEnd(12)).join(' | ');
  const header = `${'Time Bin'.padEnd(12)} | ${'Pairs'.padEnd(8)} | ${'Ref Rate'.padEnd(8)} | ${modelHeaders}`;
  lines.push(header);
  lines.push('-'.repeat(100));

  // Rows
  for (const bin of result.bins) {
    const weights = decayModels.map(m =>
      bin.meanDecayWeights[m.id].toFixed(3).padEnd(12)
    ).join(' | ');

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
  const corrValues = decayModels.map(m =>
    result.correlations[m.id].toFixed(3).padEnd(12)
  ).join(' | ');

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
function buildForwardReferenceMap(
  references: TurnReference[],
): Map<number, Set<number>> {
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
 * Build time gap map for forward queries.
 * Maps source turn → future turn → time gap.
 */
function buildForwardTimeGapMap(
  references: TurnReference[],
): Map<number, Map<number, number>> {
  const map = new Map<number, Map<number, number>>();

  for (const ref of references) {
    if (!map.has(ref.referencedTurnIndex)) {
      map.set(ref.referencedTurnIndex, new Map());
    }
    map.get(ref.referencedTurnIndex)!.set(ref.userTurnIndex, ref.timeGapMs);
  }

  return map;
}

/**
 * Evaluate forward prediction for a single source turn.
 * Given turn T, predict which future turns will reference it.
 */
function evaluateForwardQuery(
  sourceTurnIndex: number,
  candidateFutureTurns: number[],
  actualReferencingTurns: Set<number>,
  timeGaps: Map<number, number>,
  decayModel: DecayModelConfig,
): QueryEvaluation {
  // Score each candidate future turn
  const candidates: CandidateTurn[] = candidateFutureTurns.map(futureTurnIndex => {
    const timeGapMs = timeGaps.get(futureTurnIndex) ?? 0;
    const decayWeight = calculateWeight(decayModel, timeGapMs);
    const isRelevant = actualReferencingTurns.has(futureTurnIndex);

    return {
      turnIndex: futureTurnIndex,
      timeGapMs,
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
    const forwardMap = buildForwardReferenceMap(session.references);
    const timeGapMap = buildForwardTimeGapMap(session.references);

    // For each source turn that has future references
    for (const [sourceTurnIndex, referencingTurns] of forwardMap) {
      if (referencingTurns.size === 0) continue;

      // Candidates are all turns after the source
      const candidateFutureTurns = Array.from(
        { length: session.turnCount - sourceTurnIndex - 1 },
        (_, i) => sourceTurnIndex + 1 + i
      );

      if (candidateFutureTurns.length === 0) continue;

      // Get time gaps for this source turn
      const timeGaps = timeGapMap.get(sourceTurnIndex) ?? new Map();

      // Estimate time gaps for candidates without explicit references
      for (const futureIdx of candidateFutureTurns) {
        if (!timeGaps.has(futureIdx)) {
          // Find a reference with known time gap to estimate
          const knownRef = session.references.find(
            r => r.referencedTurnIndex === sourceTurnIndex && r.userTurnIndex !== futureIdx
          );
          if (knownRef) {
            const refTurnDist = knownRef.userTurnIndex - sourceTurnIndex;
            const thisTurnDist = futureIdx - sourceTurnIndex;
            const estimatedGap = (knownRef.timeGapMs / refTurnDist) * thisTurnDist;
            timeGaps.set(futureIdx, estimatedGap);
          } else {
            // Default to 5 minutes per turn distance
            timeGaps.set(futureIdx, (futureIdx - sourceTurnIndex) * 5 * MS_PER_MINUTE);
          }
        }
      }

      const evaluation = evaluateForwardQuery(
        sourceTurnIndex,
        candidateFutureTurns,
        referencingTurns,
        timeGaps,
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
    const forward = forwardResults.find(f => f.modelId === backward.modelId);
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
