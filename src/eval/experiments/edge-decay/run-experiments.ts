/**
 * Main experiment runner for edge decay validation.
 */

import type { DecayModelConfig } from './types.js';
import type { SessionReferences, EdgeDecayExperimentResults } from './reference-types.js';
import { extractReferences, computeReferenceStats, type SessionSource } from './reference-extractor.js';
import {
  compareRetrievalRanking,
  evaluateTimeOffsetCorrelation,
  formatRetrievalRankingTable,
  formatTimeOffsetTable,
} from './retrieval-ranking.js';
import { PRESET_MODELS } from './presets.js';

export interface ExperimentOptions {
  /** Decay models to evaluate. Defaults to all presets. */
  decayModels?: DecayModelConfig[];
  /** Whether to run time-offset correlation experiment. */
  runTimeOffsetCorrelation?: boolean;
  /** Verbose output. */
  verbose?: boolean;
}

/**
 * Run the complete edge decay validation experiment.
 */
export async function runEdgeDecayExperiments(
  sessions: SessionSource[],
  options: ExperimentOptions = {},
): Promise<EdgeDecayExperimentResults> {
  const {
    decayModels = PRESET_MODELS,
    runTimeOffsetCorrelation = true,
    verbose = true,
  } = options;

  if (verbose) {
    console.log('\n--- Extracting turn-to-turn references ---');
  }

  // Extract references from all sessions
  const sessionRefs = await extractReferences(sessions, verbose);

  // Compute stats
  const stats = computeReferenceStats(sessionRefs);

  if (verbose) {
    console.log('\nReference statistics:');
    console.log(`  Total turns: ${stats.totalTurns}`);
    console.log(`  Total references: ${stats.totalReferences}`);
    console.log(`  Avg refs per turn: ${stats.avgRefsPerTurn.toFixed(2)}`);
    console.log('  By type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`    ${type}: ${count}`);
    }
    console.log('  By confidence:');
    for (const [conf, count] of Object.entries(stats.byConfidence)) {
      console.log(`    ${conf}: ${count}`);
    }
  }

  if (verbose) {
    console.log('\n--- Running retrieval ranking experiment ---');
  }

  // Run retrieval ranking
  const retrievalResults = compareRetrievalRanking(sessionRefs, decayModels, verbose);

  if (verbose) {
    console.log('\n' + formatRetrievalRankingTable(retrievalResults));
  }

  // Run time-offset correlation
  let timeOffsetResult;
  if (runTimeOffsetCorrelation) {
    if (verbose) {
      console.log('\n--- Running time-offset correlation experiment ---');
    }

    timeOffsetResult = evaluateTimeOffsetCorrelation(sessionRefs, decayModels);

    if (verbose) {
      console.log('\n' + formatTimeOffsetTable(timeOffsetResult, decayModels));
    }
  }

  // Build results
  const results: EdgeDecayExperimentResults = {
    generatedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    turnCount: stats.totalTurns,
    referenceCount: stats.totalReferences,
    retrievalRanking: retrievalResults,
    timeOffsetCorrelation: timeOffsetResult,
  };

  // Print recommendations
  if (verbose) {
    console.log('\n--- Recommendations ---');

    // Find best model by MRR
    const sortedByMRR = [...retrievalResults].sort((a, b) => b.mrr - a.mrr);
    const bestModel = sortedByMRR[0];

    console.log(`  Best model by MRR: ${bestModel.modelName} (MRR=${bestModel.mrr.toFixed(3)})`);

    // Find model with highest rank@1
    const sortedByRank1 = [...retrievalResults].sort(
      (a, b) => b.rankDistribution.rank1 - a.rankDistribution.rank1
    );
    const bestRank1 = sortedByRank1[0];

    if (bestRank1.modelId !== bestModel.modelId) {
      console.log(`  Best model by Rank@1: ${bestRank1.modelName} (${bestRank1.rankDistribution.rank1} queries)`);
    }

    // Check if multi-linear outperforms exponential
    const multiLinear = retrievalResults.find(r => r.modelId === 'multi-linear-default');
    const exponential = retrievalResults.find(r => r.modelId === 'exponential');

    if (multiLinear && exponential) {
      const diff = multiLinear.mrr - exponential.mrr;
      if (diff > 0.01) {
        console.log(`  Multi-linear outperforms exponential by ${(diff * 100).toFixed(1)}% MRR`);
      } else if (diff < -0.01) {
        console.log(`  Exponential outperforms multi-linear by ${(-diff * 100).toFixed(1)}% MRR`);
      } else {
        console.log(`  Multi-linear and exponential perform similarly`);
      }
    }

    // Correlation insights
    if (timeOffsetResult) {
      const corrs = Object.entries(timeOffsetResult.correlations)
        .map(([id, corr]) => ({ id, corr }))
        .sort((a, b) => b.corr - a.corr);

      console.log(`  Best correlation with reference rate: ${corrs[0].id} (ρ=${corrs[0].corr.toFixed(3)})`);
    }
  }

  return results;
}

export { extractReferences, computeReferenceStats } from './reference-extractor.js';
export { compareRetrievalRanking, evaluateTimeOffsetCorrelation } from './retrieval-ranking.js';
