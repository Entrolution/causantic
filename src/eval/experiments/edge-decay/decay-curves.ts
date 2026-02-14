/**
 * Implementation of various decay curve functions.
 *
 * Distance metric: hop distance (turn count difference).
 * All functions take a generic numeric distance — the unit is determined
 * by how the caller parameterizes the DecayModelConfig.
 */

import type { DecayTier, DecayModelConfig } from './types.js';

/**
 * Calculate weight for a single linear decay tier.
 */
export function tierWeight(tier: DecayTier, distance: number): number {
  if (distance < tier.holdPeriodMs) {
    return tier.initialWeight;
  }
  const decayDist = distance - tier.holdPeriodMs;
  return Math.max(0, tier.initialWeight - tier.decayRatePerMs * decayDist);
}

/**
 * Calculate total weight for multi-linear decay (sum of tiers).
 */
export function multiLinearWeight(tiers: DecayTier[], distance: number): number {
  return tiers.reduce((sum, tier) => sum + tierWeight(tier, distance), 0);
}

/**
 * Calculate weight for simple linear decay.
 */
export function linearWeight(initialWeight: number, decayRate: number, distance: number): number {
  return Math.max(0, initialWeight - decayRate * distance);
}

/**
 * Calculate weight for delayed linear decay (plateau then decay).
 */
export function delayedLinearWeight(
  initialWeight: number,
  holdPeriod: number,
  decayRate: number,
  distance: number,
): number {
  if (distance < holdPeriod) {
    return initialWeight;
  }
  const decayDist = distance - holdPeriod;
  return Math.max(0, initialWeight - decayRate * decayDist);
}

/**
 * Calculate weight for exponential decay.
 */
export function exponentialWeight(
  initialWeight: number,
  decayRate: number,
  distance: number,
): number {
  return initialWeight * Math.exp(-decayRate * distance);
}

/**
 * Calculate weight for power-law decay.
 * w(d) = w₀ * (1 + k*d)^(-α)
 */
export function powerLawWeight(
  initialWeight: number,
  decayRate: number,
  powerExponent: number,
  distance: number,
): number {
  return initialWeight * Math.pow(1 + decayRate * distance, -powerExponent);
}

/**
 * Calculate death distance for linear decay (when weight reaches zero).
 */
export function linearDeathDistance(initialWeight: number, decayRate: number): number {
  return initialWeight / decayRate;
}

/**
 * Calculate death distance for a single tier.
 */
export function tierDeathDistance(tier: DecayTier): number {
  return tier.holdPeriodMs + tier.initialWeight / tier.decayRatePerMs;
}

/**
 * Calculate death distance for multi-linear decay (when total reaches zero).
 * This is when the longest-lived tier dies.
 */
export function multiLinearDeathDistance(tiers: DecayTier[]): number {
  return Math.max(...tiers.map(tierDeathDistance));
}

/**
 * Generic weight calculation based on model config.
 * @param config - Decay model configuration
 * @param distance - Hop distance (turn count difference)
 */
export function calculateWeight(config: DecayModelConfig, distance: number): number {
  switch (config.type) {
    case 'linear':
      return linearWeight(config.initialWeight ?? 1.0, config.decayRate ?? 0.0001, distance);

    case 'delayed-linear':
      return delayedLinearWeight(
        config.initialWeight ?? 1.0,
        config.holdPeriodMs ?? 0,
        config.decayRate ?? 0.0001,
        distance,
      );

    case 'multi-linear':
      if (!config.tiers || config.tiers.length === 0) {
        throw new Error('Multi-linear model requires tiers');
      }
      return multiLinearWeight(config.tiers, distance);

    case 'exponential':
      return exponentialWeight(config.initialWeight ?? 1.0, config.decayRate ?? 0.0001, distance);

    case 'power-law':
      return powerLawWeight(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.001,
        config.powerExponent ?? 1.0,
        distance,
      );

    default:
      throw new Error(`Unknown decay type: ${config.type}`);
  }
}

/**
 * Calculate death distance for a model (null if asymptotic).
 */
export function calculateDeathDistance(config: DecayModelConfig): number | null {
  switch (config.type) {
    case 'linear':
      return linearDeathDistance(config.initialWeight ?? 1.0, config.decayRate ?? 0.0001);

    case 'delayed-linear':
      return (
        (config.holdPeriodMs ?? 0) +
        linearDeathDistance(config.initialWeight ?? 1.0, config.decayRate ?? 0.0001)
      );

    case 'multi-linear':
      if (!config.tiers || config.tiers.length === 0) {
        return null;
      }
      return multiLinearDeathDistance(config.tiers);

    case 'exponential':
    case 'power-law':
      // Asymptotic - never reaches zero
      return null;

    default:
      return null;
  }
}

/**
 * Check if edge is alive (weight > 0) at given distance.
 */
export function isAlive(config: DecayModelConfig, distance: number): boolean {
  return calculateWeight(config, distance) > 0;
}

/**
 * Find peak weight (at d=0) for a model.
 */
export function peakWeight(config: DecayModelConfig): number {
  return calculateWeight(config, 0);
}
