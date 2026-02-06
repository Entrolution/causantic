/**
 * Topic continuity detection experiment module.
 *
 * Classifies whether a user's message continues the previous topic
 * or starts a new topic, supporting the D-T-D model's edge creation logic.
 */

// Types
export type {
  TransitionLabel,
  Confidence,
  TurnTransition,
  TransitionFeatures,
  ClassificationResult,
  ClassifierMetrics,
  ModelResults,
  FeatureAblation,
  DatasetStats,
  ExperimentReport,
  ThresholdSweepRow,
  TimeGapSweepRow,
} from './types.js';

// Labeling
export {
  generateTransitionLabels,
  generateSessionTransitions,
  computeDatasetStats,
  filterHighConfidence,
  balanceDataset,
  type SessionSource,
  type LabelerOptions,
} from './labeler.js';

// Lexical features
export {
  hasTopicShiftMarker,
  hasContinuationMarker,
  extractFilePaths,
  computeFilePathOverlap,
  extractKeywords,
  computeKeywordOverlap,
  extractLexicalFeatures,
  computeLexicalScore,
  classifyWithLexicalFeatures,
  type LexicalClassificationResult,
} from './lexical-features.js';

// Embedding classifier
export {
  embedTransitions,
  classifyWithEmbeddings,
  embeddingDistanceToScore,
  getEmbeddingDistances,
  createEmbeddingCache,
  classifyFromCache,
  type EmbeddedTransition,
  type EmbeddingCache,
} from './embedding-classifier.js';

// Hybrid classifier
export {
  computeHybridScore,
  classifyWithHybrid,
  classifyWithLexicalOnly,
  classifyWithAblation,
  DEFAULT_WEIGHTS,
  ALL_FEATURES,
  EMBEDDING_ONLY,
  LEXICAL_ONLY,
  ABLATION_CONFIGS,
  type HybridWeights,
  type FeatureFlags,
} from './hybrid-classifier.js';

// Experiment runner
export {
  runTopicContinuityExperiment,
  computeRocAuc,
  computeMetrics,
  findOptimalThreshold,
  exportTransitionsDataset,
  type ExperimentOptions,
} from './run-experiment.js';
