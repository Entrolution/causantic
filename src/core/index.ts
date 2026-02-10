/**
 * Core types and utilities shared across the codebase.
 *
 * This barrel export provides a clean import path for production code,
 * preventing direct imports from experimental directories.
 */

export type {
  DecayTier,
  DecayModelConfig,
  DecayCurvePoint,
  DecayCurve,
  SimulationParams,
  DecayModelComparison,
} from './decay-types.js';

export {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  formatTime,
} from './decay-types.js';

export {
  hasTopicShiftMarker,
  hasContinuationMarker,
  extractFilePaths,
  computeFilePathOverlap,
  extractKeywords,
  computeKeywordOverlap,
} from './lexical-features.js';

export type {
  ModelBenchmarkResult,
  BenchmarkResult,
  BenchmarkOptions,
} from './benchmark-types.js';
