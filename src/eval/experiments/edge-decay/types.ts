/**
 * Types for edge decay modeling and simulation.
 *
 * Re-exports from src/core/decay-types.ts — the canonical location.
 * This file exists for backward compatibility with eval code that
 * imports from './types.js'.
 */

export type {
  DecayTier,
  DecayModelConfig,
  DecayCurvePoint,
  DecayCurve,
  SimulationParams,
  DecayModelComparison,
} from '../../../core/decay-types.js';

export {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  formatTime,
} from '../../../core/decay-types.js';
