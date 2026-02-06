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
  filterLongRangeReferences,
  type ReferenceFilterOptions,
} from './retrieval-ranking.js';
import { PRESET_MODELS } from './presets.js';
import { MS_PER_MINUTE } from './types.js';

export interface ExperimentOptions {
  /** Decay models to evaluate. Defaults to all presets. */
  decayModels?: DecayModelConfig[];
  /** Whether to run time-offset correlation experiment. */
  runTimeOffsetCorrelation?: boolean;
  /** Whether to run stratified analysis by context distance. */
  runStratifiedAnalysis?: boolean;
  /** Verbose output. */
  verbose?: boolean;
}

/**
 * Stratified analysis configurations.
 * Each simulates a different "context window" size that Claude has available.
 */
const STRATIFICATION_CONFIGS: Array<{
  name: string;
  description: string;
  filter: ReferenceFilterOptions;
}> = [
  {
    name: 'All References',
    description: 'Baseline: all detected references',
    filter: {},
  },
  {
    name: 'Beyond Immediate (>1 turn)',
    description: 'Exclude immediately previous turn',
    filter: { minTurnDistance: 2, excludeAdjacent: true },
  },
  {
    name: 'Beyond Recent (>3 turns)',
    description: 'Simulate 3-turn context window',
    filter: { minTurnDistance: 4, excludeAdjacent: true },
  },
  {
    name: 'Beyond Session (>30 min)',
    description: 'Simulate session-level context boundary',
    filter: { minTimeGapMs: 30 * MS_PER_MINUTE, excludeAdjacent: true },
  },
  {
    name: 'Long-Range (>5 turns, high conf)',
    description: 'High confidence references to distant turns',
    filter: { minTurnDistance: 6, excludeAdjacent: true, highConfidenceOnly: true },
  },
];

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

  // Run stratified analysis
  const stratifiedResults: Record<string, typeof retrievalResults> = {};
  if (options.runStratifiedAnalysis !== false) {
    if (verbose) {
      console.log('\n' + '='.repeat(90));
      console.log('  STRATIFIED ANALYSIS: Long-Range Retrieval');
      console.log('  (Simulating what memory system needs to retrieve beyond Claude\'s context)');
      console.log('='.repeat(90));
    }

    for (const config of STRATIFICATION_CONFIGS) {
      const filtered = filterLongRangeReferences(sessionRefs, config.filter);
      const totalRefs = filtered.reduce((sum, s) => sum + s.references.length, 0);

      if (totalRefs === 0) {
        if (verbose) {
          console.log(`\n--- ${config.name} ---`);
          console.log(`  ${config.description}`);
          console.log(`  No references match filter criteria`);
        }
        continue;
      }

      if (verbose) {
        console.log(`\n--- ${config.name} ---`);
        console.log(`  ${config.description}`);
        console.log(`  References: ${totalRefs}`);
      }

      const results = compareRetrievalRanking(filtered, decayModels, false);
      stratifiedResults[config.name] = results;

      if (verbose) {
        // Print compact comparison
        console.log('\n  Model                     | MRR    | Rank@1');
        console.log('  ' + '-'.repeat(50));
        const sorted = [...results].sort((a, b) => b.mrr - a.mrr);
        for (const r of sorted.slice(0, 5)) {
          const pct = r.queryCount > 0 ? ((r.rankDistribution.rank1 / r.queryCount) * 100).toFixed(0) : '0';
          console.log(`  ${r.modelName.padEnd(25)} | ${r.mrr.toFixed(3)}  | ${r.rankDistribution.rank1} (${pct}%)`);
        }
      }
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
    console.log('\n' + '='.repeat(90));
    console.log('  RECOMMENDATIONS');
    console.log('='.repeat(90));

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

    // Stratified insights
    if (Object.keys(stratifiedResults).length > 0) {
      console.log('\n  Long-range retrieval insights:');

      // Find best model for long-range
      const longRangeKey = 'Beyond Recent (>3 turns)';
      const longRangeResults = stratifiedResults[longRangeKey];
      if (longRangeResults && longRangeResults.length > 0) {
        const sorted = [...longRangeResults].sort((a, b) => b.mrr - a.mrr);
        console.log(`  Best model for ${longRangeKey}: ${sorted[0].modelName} (MRR=${sorted[0].mrr.toFixed(3)})`);

        // Compare multi-linear vs exponential for long-range
        const ml = longRangeResults.find(r => r.modelId === 'multi-linear-default');
        const exp = longRangeResults.find(r => r.modelId === 'exponential');
        if (ml && exp) {
          const diff = ml.mrr - exp.mrr;
          if (Math.abs(diff) > 0.01) {
            const better = diff > 0 ? 'Multi-linear' : 'Exponential';
            const worse = diff > 0 ? 'Exponential' : 'Multi-linear';
            console.log(`  ${better} outperforms ${worse} by ${(Math.abs(diff) * 100).toFixed(1)}% MRR for long-range`);
          } else {
            console.log(`  Multi-linear and Exponential perform similarly for long-range`);
          }
        }
      }
    }
  }

  return results;
}

export { extractReferences, computeReferenceStats } from './reference-extractor.js';
export { compareRetrievalRanking, evaluateTimeOffsetCorrelation } from './retrieval-ranking.js';
