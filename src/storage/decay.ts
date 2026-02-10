/**
 * Decay weight calculation for edges.
 * Supports both time-based decay (legacy) and vector clock-based decay.
 */

import type { DecayModelConfig } from '../core/decay-types.js';
import { type VectorClock, hopCount, deserialize } from '../temporal/vector-clock.js';

/**
 * Edge direction for hop decay.
 */
export type EdgeDirection = 'backward' | 'forward';

/**
 * Hop decay curve type.
 */
export type HopDecayType = 'exponential' | 'linear' | 'delayed-linear';

/**
 * Configuration for hop-based decay curves.
 * Different curves are optimal for different directions:
 * - Backward (4-20 hops): Linear dies@10 (MRR=0.688)
 * - Forward (1-20 hops): Delayed linear 5h/dies@20 (MRR=0.849)
 */
export interface HopDecayConfig {
  /** Decay curve type */
  type: HopDecayType;
  /** For exponential: weight = weightPerHop^hops */
  weightPerHop?: number;
  /** For linear/delayed-linear: decay rate per hop */
  decayPerHop?: number;
  /** For delayed-linear: hold full weight for N hops */
  holdHops?: number;
  /** Minimum weight before edge is considered dead */
  minWeight: number;
}

/**
 * Backward hop decay: Linear (dies@10)
 * Optimal for retrieving causally-related context 4-20 hops back.
 * MRR=0.688 (+35% vs exponential 0.80)
 */
export const BACKWARD_HOP_DECAY: HopDecayConfig = {
  type: 'linear',
  decayPerHop: 0.1, // weight = max(0, 1 - hops * 0.1), dies at 10 hops
  minWeight: 0.01,
};

/**
 * Forward hop decay: Delayed linear (5-hop hold, dies@20)
 * Optimal for predicting future context 1-20 hops forward.
 * MRR=0.849 (+271% vs exponential 0.80)
 */
export const FORWARD_HOP_DECAY: HopDecayConfig = {
  type: 'delayed-linear',
  holdHops: 5, // Full weight for first 5 hops
  decayPerHop: 0.067, // Then linear decay, dies at ~20 hops
  minWeight: 0.01,
};

/**
 * Legacy configuration for vector clock-based decay (exponential only).
 * @deprecated Use HopDecayConfig with direction-specific curves instead.
 */
export interface VectorDecayConfig {
  /** Weight multiplier per hop (e.g., 0.85 = 15% decay per hop) */
  weightPerHop: number;
  /** Minimum weight before edge is considered dead */
  minWeight: number;
}

/**
 * Default vector decay configuration (legacy exponential).
 * @deprecated Use BACKWARD_HOP_DECAY or FORWARD_HOP_DECAY instead.
 */
export const DEFAULT_VECTOR_DECAY: VectorDecayConfig = {
  weightPerHop: 0.80,
  minWeight: 0.01,
};

/**
 * Calculate hop-based decay weight using direction-specific curves.
 *
 * @param hops - Number of hops from reference point
 * @param config - Hop decay configuration
 * @returns Weight value (0 to 1), or 0 if below minWeight
 */
export function calculateHopDecayWeight(hops: number, config: HopDecayConfig): number {
  let weight: number;

  switch (config.type) {
    case 'exponential': {
      const wph = config.weightPerHop ?? 0.80;
      weight = Math.pow(wph, hops);
      break;
    }
    case 'linear': {
      const rate = config.decayPerHop ?? 0.1;
      weight = Math.max(0, 1 - hops * rate);
      break;
    }
    case 'delayed-linear': {
      const hold = config.holdHops ?? 0;
      const rate = config.decayPerHop ?? 0.067;
      if (hops < hold) {
        weight = 1;
      } else {
        weight = Math.max(0, 1 - (hops - hold) * rate);
      }
      break;
    }
    default:
      weight = 1;
  }

  return weight >= config.minWeight ? weight : 0;
}

/**
 * Calculate decay weight for an edge based on direction.
 *
 * @param edgeClock - Vector clock stamped on the edge
 * @param referenceClock - Current reference clock for the project
 * @param direction - Edge direction ('backward' or 'forward')
 * @returns Weight value (0 to 1), or 0 if below minWeight
 */
export function calculateDirectionalDecayWeight(
  edgeClock: VectorClock,
  referenceClock: VectorClock,
  direction: EdgeDirection
): number {
  const hops = hopCount(edgeClock, referenceClock);
  const config = direction === 'backward' ? BACKWARD_HOP_DECAY : FORWARD_HOP_DECAY;
  return calculateHopDecayWeight(hops, config);
}

/**
 * Calculate decay weight based on vector clock hop count.
 * @deprecated Use calculateDirectionalDecayWeight for direction-specific curves.
 *
 * @param edgeClock - Vector clock stamped on the edge
 * @param referenceClock - Current reference clock for the project
 * @param config - Vector decay configuration
 * @returns Weight value (0 to 1), or 0 if below minWeight
 */
export function calculateVectorDecayWeight(
  edgeClock: VectorClock,
  referenceClock: VectorClock,
  config: VectorDecayConfig = DEFAULT_VECTOR_DECAY
): number {
  const hops = hopCount(edgeClock, referenceClock);
  const weight = Math.pow(config.weightPerHop, hops);
  return weight >= config.minWeight ? weight : 0;
}

/**
 * Calculate decay weight with fallback for legacy edges.
 * Uses vector clock decay if available, falls back to time-based decay.
 *
 * @param edgeClockJson - JSON serialized vector clock (may be null for legacy edges)
 * @param referenceClock - Current reference clock for the project
 * @param direction - Edge direction for curve selection
 * @param createdAtMs - Edge creation time in milliseconds (for fallback)
 * @param queryTimeMs - Query time in milliseconds (for fallback)
 * @param timeConfig - Time-based decay configuration (for fallback)
 * @returns Computed weight value
 */
export function calculateDecayWeightWithFallback(
  edgeClockJson: string | null,
  referenceClock: VectorClock,
  direction: EdgeDirection,
  createdAtMs: number,
  queryTimeMs: number,
  timeConfig: DecayModelConfig
): number {
  // Try vector clock decay first
  if (edgeClockJson) {
    const edgeClock = deserialize(edgeClockJson);
    if (Object.keys(edgeClock).length > 0) {
      return calculateDirectionalDecayWeight(edgeClock, referenceClock, direction);
    }
  }

  // Fallback to time-based decay
  return calculateDecayWeight(timeConfig, queryTimeMs - createdAtMs);
}

/**
 * @deprecated Use calculateDecayWeightWithFallback with direction parameter.
 */
export function calculateDecayWeightWithFallbackLegacy(
  edgeClockJson: string | null,
  referenceClock: VectorClock,
  vectorConfig: VectorDecayConfig,
  createdAtMs: number,
  queryTimeMs: number,
  timeConfig: DecayModelConfig
): number {
  if (edgeClockJson) {
    const edgeClock = deserialize(edgeClockJson);
    if (Object.keys(edgeClock).length > 0) {
      return calculateVectorDecayWeight(edgeClock, referenceClock, vectorConfig);
    }
  }
  return calculateDecayWeight(timeConfig, queryTimeMs - createdAtMs);
}

/**
 * Calculate boosted weight for edges with multiple links.
 * Edges that have been created multiple times (same source/target pair)
 * get a boost to resist decay.
 *
 * @param baseWeight - Base weight after decay
 * @param linkCount - Number of times this edge was created
 * @returns Boosted weight
 */
export function applyLinkBoost(baseWeight: number, linkCount: number): number {
  if (linkCount <= 1) return baseWeight;
  // Logarithmic boost: 5 links = ~1.16x, 10 links = ~1.23x
  const boostFactor = 1 + Math.log(linkCount) * 0.1;
  return baseWeight * boostFactor;
}

/**
 * Calculate the decay weight at a given age.
 * @param config - Decay model configuration
 * @param ageMs - Age of the edge in milliseconds
 * @returns Weight value (0 to initialWeight)
 */
export function calculateDecayWeight(config: DecayModelConfig, ageMs: number): number {
  if (ageMs < 0) {
    return config.initialWeight ?? 1.0;
  }

  switch (config.type) {
    case 'linear':
      return calculateLinear(config, ageMs);
    case 'delayed-linear':
      return calculateDelayedLinear(config, ageMs);
    case 'multi-linear':
      return calculateMultiLinear(config, ageMs);
    case 'exponential':
      return calculateExponential(config, ageMs);
    case 'power-law':
      return calculatePowerLaw(config, ageMs);
    default:
      return config.initialWeight ?? 1.0;
  }
}

/**
 * Simple linear decay: w(t) = w0 - rate * t
 */
function calculateLinear(config: DecayModelConfig, ageMs: number): number {
  const w0 = config.initialWeight ?? 1.0;
  const rate = config.decayRate ?? 0;
  const weight = w0 - rate * ageMs;
  return Math.max(0, weight);
}

/**
 * Delayed linear: hold at w0 for holdPeriod, then linear decay.
 * w(t) = w0 if t < hold, else w0 - rate * (t - hold)
 */
function calculateDelayedLinear(config: DecayModelConfig, ageMs: number): number {
  const w0 = config.initialWeight ?? 1.0;
  const hold = config.holdPeriodMs ?? 0;
  const rate = config.decayRate ?? 0;

  if (ageMs < hold) {
    return w0;
  }

  const decayTime = ageMs - hold;
  const weight = w0 - rate * decayTime;
  return Math.max(0, weight);
}

/**
 * Multi-linear: sum of multiple decay tiers.
 * Each tier has its own hold period and decay rate.
 */
function calculateMultiLinear(config: DecayModelConfig, ageMs: number): number {
  const tiers = config.tiers ?? [];
  let totalWeight = 0;

  for (const tier of tiers) {
    if (ageMs < tier.holdPeriodMs) {
      totalWeight += tier.initialWeight;
    } else {
      const decayTime = ageMs - tier.holdPeriodMs;
      const weight = tier.initialWeight - tier.decayRatePerMs * decayTime;
      totalWeight += Math.max(0, weight);
    }
  }

  return totalWeight;
}

/**
 * Exponential decay: w(t) = w0 * e^(-rate * t)
 */
function calculateExponential(config: DecayModelConfig, ageMs: number): number {
  const w0 = config.initialWeight ?? 1.0;
  const rate = config.decayRate ?? 0;
  return w0 * Math.exp(-rate * ageMs);
}

/**
 * Power law decay: w(t) = w0 / (1 + k*t)^alpha
 */
function calculatePowerLaw(config: DecayModelConfig, ageMs: number): number {
  const w0 = config.initialWeight ?? 1.0;
  const k = config.decayRate ?? 0;
  const alpha = config.powerExponent ?? 1.0;
  return w0 / Math.pow(1 + k * ageMs, alpha);
}

/**
 * Calculate the time when weight reaches zero (or null if asymptotic).
 */
export function getDeathTime(config: DecayModelConfig): number | null {
  switch (config.type) {
    case 'linear': {
      const w0 = config.initialWeight ?? 1.0;
      const rate = config.decayRate ?? 0;
      if (rate <= 0) return null;
      return w0 / rate;
    }
    case 'delayed-linear': {
      const w0 = config.initialWeight ?? 1.0;
      const hold = config.holdPeriodMs ?? 0;
      const rate = config.decayRate ?? 0;
      if (rate <= 0) return null;
      return hold + w0 / rate;
    }
    case 'multi-linear': {
      const tiers = config.tiers ?? [];
      if (tiers.length === 0) return 0;
      // Find the tier that dies last
      let maxDeathTime = 0;
      for (const tier of tiers) {
        if (tier.decayRatePerMs <= 0) return null;
        const deathTime = tier.holdPeriodMs + tier.initialWeight / tier.decayRatePerMs;
        maxDeathTime = Math.max(maxDeathTime, deathTime);
      }
      return maxDeathTime;
    }
    case 'exponential':
    case 'power-law':
      // Asymptotic - never reaches exactly zero
      return null;
    default:
      return null;
  }
}
