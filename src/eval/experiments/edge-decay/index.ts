/**
 * Edge decay modeling experiment module.
 *
 * Distance metric: hop distance (turn count difference).
 */

// Types
export type {
  DecayTier,
  DecayModelConfig,
  DecayCurvePoint,
  DecayCurve,
  SimulationParams,
  DecayModelComparison,
} from './types.js';

export {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  formatTime,
} from './types.js';

// Decay curve calculations
export {
  tierWeight,
  multiLinearWeight,
  linearWeight,
  delayedLinearWeight,
  exponentialWeight,
  powerLawWeight,
  linearDeathDistance,
  tierDeathDistance,
  multiLinearDeathDistance,
  calculateWeight,
  calculateDeathDistance,
  isAlive,
  peakWeight,
} from './decay-curves.js';

// Presets
export {
  SHORT_TERM_TIER,
  MEDIUM_TERM_TIER,
  LONG_TERM_TIER,
  DEFAULT_TIERS,
  FAST_DECAY_TIERS,
  SLOW_DECAY_TIERS,
  PRESET_MODELS,
  getPresetModel,
  getPresetModelIds,
} from './presets.js';

// Simulation
export {
  DEFAULT_SIMULATION_PARAMS,
  simulateModel,
  compareModels,
  generateComparisonTable,
  exportCurvesCSV,
  findTimeAtWeight,
  generateMilestonesTable,
  computeAUC,
  generateAUCTable,
} from './simulate.js';

// Reference extraction
export type {
  TurnReference,
  SessionReferences,
  CandidateTurn,
  QueryEvaluation,
  RetrievalRankingResult,
  HopDistanceBin,
  HopDistanceCorrelationResult,
  EdgeDecayExperimentResults,
  ReferenceType,
} from './reference-types.js';

export {
  extractSessionReferences,
  extractReferences,
  computeReferenceStats,
  type SessionSource,
} from './reference-extractor.js';

// Retrieval ranking experiment
export {
  evaluateRetrievalRanking,
  compareRetrievalRanking,
  evaluateForwardPrediction,
  compareForwardPrediction,
  evaluateHopDistanceCorrelation,
  formatRetrievalRankingTable,
  formatHopDistanceTable,
  formatDirectionalComparison,
  filterLongRangeReferences,
  type ReferenceFilterOptions,
} from './retrieval-ranking.js';

// Experiment runner
export { runEdgeDecayExperiments, type ExperimentOptions } from './run-experiments.js';
