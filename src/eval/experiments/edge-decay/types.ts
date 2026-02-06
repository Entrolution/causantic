/**
 * Types for edge decay modeling and simulation.
 */

/**
 * A single decay tier in a multi-linear decay model.
 */
export interface DecayTier {
  /** Human-readable name for this tier */
  name: string;
  /** Initial weight contribution from this tier */
  initialWeight: number;
  /** Time (ms) before decay begins (hold/plateau period) */
  holdPeriodMs: number;
  /** Decay rate in weight units per millisecond */
  decayRatePerMs: number;
}

/**
 * Configuration for a complete decay model.
 */
export interface DecayModelConfig {
  /** Model identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the model */
  description: string;
  /** Decay curve type */
  type: 'linear' | 'multi-linear' | 'exponential' | 'power-law' | 'delayed-linear';
  /** Tiers (for multi-linear models) */
  tiers?: DecayTier[];
  /** Single decay rate (for simple models) */
  decayRate?: number;
  /** Hold period (for delayed models) */
  holdPeriodMs?: number;
  /** Power exponent (for power-law) */
  powerExponent?: number;
  /** Initial weight (for simple models) */
  initialWeight?: number;
}

/**
 * A single data point in a decay curve.
 */
export interface DecayCurvePoint {
  /** Time in milliseconds since edge creation */
  timeMs: number;
  /** Time in human-readable units (minutes/hours/days) */
  timeHuman: string;
  /** Edge weight at this time */
  weight: number;
  /** Whether the edge is still alive (weight > 0) */
  alive: boolean;
}

/**
 * Complete decay curve for a model.
 */
export interface DecayCurve {
  /** Model configuration */
  config: DecayModelConfig;
  /** Data points along the curve */
  points: DecayCurvePoint[];
  /** Time when edge weight reaches zero (null if asymptotic) */
  deathTimeMs: number | null;
  /** Peak weight (at t=0) */
  peakWeight: number;
  /** Weight at 1 hour */
  weightAt1Hour: number;
  /** Weight at 24 hours */
  weightAt24Hours: number;
  /** Weight at 7 days */
  weightAt7Days: number;
}

/**
 * Simulation parameters.
 */
export interface SimulationParams {
  /** Maximum time to simulate (ms) */
  maxTimeMs: number;
  /** Number of sample points */
  numPoints: number;
  /** Whether to use logarithmic time spacing */
  logScale: boolean;
}

/**
 * Comparison of multiple decay models.
 */
export interface DecayModelComparison {
  /** Models being compared */
  models: DecayModelConfig[];
  /** Curves for each model */
  curves: DecayCurve[];
  /** Simulation parameters used */
  params: SimulationParams;
  /** Generated at timestamp */
  generatedAt: string;
}

/**
 * Time unit conversions.
 */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Format milliseconds to human-readable string.
 */
export function formatTime(ms: number): string {
  if (ms < MS_PER_MINUTE) {
    return `${(ms / MS_PER_SECOND).toFixed(0)}s`;
  }
  if (ms < MS_PER_HOUR) {
    return `${(ms / MS_PER_MINUTE).toFixed(1)}m`;
  }
  if (ms < MS_PER_DAY) {
    return `${(ms / MS_PER_HOUR).toFixed(1)}h`;
  }
  return `${(ms / MS_PER_DAY).toFixed(1)}d`;
}
