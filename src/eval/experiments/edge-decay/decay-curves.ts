/**
 * Implementation of various decay curve functions.
 */

import type { DecayTier, DecayModelConfig } from './types.js';

/**
 * Calculate weight for a single linear decay tier.
 */
export function tierWeight(tier: DecayTier, ageMs: number): number {
  if (ageMs < tier.holdPeriodMs) {
    return tier.initialWeight;
  }
  const decayTime = ageMs - tier.holdPeriodMs;
  return Math.max(0, tier.initialWeight - tier.decayRatePerMs * decayTime);
}

/**
 * Calculate total weight for multi-linear decay (sum of tiers).
 */
export function multiLinearWeight(tiers: DecayTier[], ageMs: number): number {
  return tiers.reduce((sum, tier) => sum + tierWeight(tier, ageMs), 0);
}

/**
 * Calculate weight for simple linear decay.
 */
export function linearWeight(
  initialWeight: number,
  decayRatePerMs: number,
  ageMs: number,
): number {
  return Math.max(0, initialWeight - decayRatePerMs * ageMs);
}

/**
 * Calculate weight for delayed linear decay (plateau then decay).
 */
export function delayedLinearWeight(
  initialWeight: number,
  holdPeriodMs: number,
  decayRatePerMs: number,
  ageMs: number,
): number {
  if (ageMs < holdPeriodMs) {
    return initialWeight;
  }
  const decayTime = ageMs - holdPeriodMs;
  return Math.max(0, initialWeight - decayRatePerMs * decayTime);
}

/**
 * Calculate weight for exponential decay.
 */
export function exponentialWeight(
  initialWeight: number,
  decayRatePerMs: number,
  ageMs: number,
): number {
  return initialWeight * Math.exp(-decayRatePerMs * ageMs);
}

/**
 * Calculate weight for power-law decay.
 * w(t) = w₀ * (1 + k*t)^(-α)
 */
export function powerLawWeight(
  initialWeight: number,
  decayRatePerMs: number,
  powerExponent: number,
  ageMs: number,
): number {
  return initialWeight * Math.pow(1 + decayRatePerMs * ageMs, -powerExponent);
}

/**
 * Calculate death time for linear decay (when weight reaches zero).
 */
export function linearDeathTime(initialWeight: number, decayRatePerMs: number): number {
  return initialWeight / decayRatePerMs;
}

/**
 * Calculate death time for a single tier.
 */
export function tierDeathTime(tier: DecayTier): number {
  return tier.holdPeriodMs + tier.initialWeight / tier.decayRatePerMs;
}

/**
 * Calculate death time for multi-linear decay (when total reaches zero).
 * This is when the longest-lived tier dies.
 */
export function multiLinearDeathTime(tiers: DecayTier[]): number {
  return Math.max(...tiers.map(tierDeathTime));
}

/**
 * Generic weight calculation based on model config.
 */
export function calculateWeight(config: DecayModelConfig, ageMs: number): number {
  switch (config.type) {
    case 'linear':
      return linearWeight(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.0001,
        ageMs,
      );

    case 'delayed-linear':
      return delayedLinearWeight(
        config.initialWeight ?? 1.0,
        config.holdPeriodMs ?? 0,
        config.decayRate ?? 0.0001,
        ageMs,
      );

    case 'multi-linear':
      if (!config.tiers || config.tiers.length === 0) {
        throw new Error('Multi-linear model requires tiers');
      }
      return multiLinearWeight(config.tiers, ageMs);

    case 'exponential':
      return exponentialWeight(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.0001,
        ageMs,
      );

    case 'power-law':
      return powerLawWeight(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.001,
        config.powerExponent ?? 1.0,
        ageMs,
      );

    default:
      throw new Error(`Unknown decay type: ${config.type}`);
  }
}

/**
 * Calculate death time for a model (null if asymptotic).
 */
export function calculateDeathTime(config: DecayModelConfig): number | null {
  switch (config.type) {
    case 'linear':
      return linearDeathTime(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.0001,
      );

    case 'delayed-linear':
      return (config.holdPeriodMs ?? 0) + linearDeathTime(
        config.initialWeight ?? 1.0,
        config.decayRate ?? 0.0001,
      );

    case 'multi-linear':
      if (!config.tiers || config.tiers.length === 0) {
        return null;
      }
      return multiLinearDeathTime(config.tiers);

    case 'exponential':
    case 'power-law':
      // Asymptotic - never reaches zero
      return null;

    default:
      return null;
  }
}

/**
 * Check if edge is alive (weight > 0) at given time.
 */
export function isAlive(config: DecayModelConfig, ageMs: number): boolean {
  return calculateWeight(config, ageMs) > 0;
}

/**
 * Find peak weight (at t=0) for a model.
 */
export function peakWeight(config: DecayModelConfig): number {
  return calculateWeight(config, 0);
}
