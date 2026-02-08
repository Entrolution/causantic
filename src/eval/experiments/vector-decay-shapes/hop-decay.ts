/**
 * Hop-based decay curve calculations.
 *
 * Translates the time-based decay curve concepts to hop counts:
 * - Exponential: weight = w0 * (weightPerHop)^hops
 * - Linear: weight = w0 - decayPerHop * hops
 * - Delayed Linear: hold for N hops, then linear
 * - Multi-linear: sum of multiple tiers
 */

import type { HopDecayConfig, HopDecayTier } from './types.js';

/**
 * Calculate decay weight for a given hop count.
 */
export function calculateHopDecayWeight(config: HopDecayConfig, hops: number): number {
  if (hops < 0) return config.initialWeight;

  let weight: number;

  switch (config.type) {
    case 'exponential':
      weight = calculateExponential(config, hops);
      break;
    case 'linear':
      weight = calculateLinear(config, hops);
      break;
    case 'delayed-linear':
      weight = calculateDelayedLinear(config, hops);
      break;
    case 'multi-linear':
      weight = calculateMultiLinear(config, hops);
      break;
    default:
      weight = config.initialWeight;
  }

  return weight >= config.minWeight ? weight : 0;
}

/**
 * Exponential decay by hops: w(h) = w0 * (weightPerHop)^h
 */
function calculateExponential(config: HopDecayConfig, hops: number): number {
  const w0 = config.initialWeight;
  const wph = config.weightPerHop ?? 0.8;
  return w0 * Math.pow(wph, hops);
}

/**
 * Linear decay by hops: w(h) = w0 - decayPerHop * h
 */
function calculateLinear(config: HopDecayConfig, hops: number): number {
  const w0 = config.initialWeight;
  const rate = config.decayPerHop ?? 0.1;
  return Math.max(0, w0 - rate * hops);
}

/**
 * Delayed linear: hold at w0 for holdHops, then linear decay.
 * w(h) = w0 if h < holdHops, else w0 - rate * (h - holdHops)
 */
function calculateDelayedLinear(config: HopDecayConfig, hops: number): number {
  const w0 = config.initialWeight;
  const hold = config.holdHops ?? 0;
  const rate = config.decayPerHop ?? 0.1;

  if (hops < hold) {
    return w0;
  }

  const decayHops = hops - hold;
  return Math.max(0, w0 - rate * decayHops);
}

/**
 * Multi-linear: sum of multiple tiers.
 */
function calculateMultiLinear(config: HopDecayConfig, hops: number): number {
  const tiers = config.tiers ?? [];
  let totalWeight = 0;

  for (const tier of tiers) {
    totalWeight += calculateTierWeight(tier, hops);
  }

  return totalWeight;
}

/**
 * Calculate weight for a single tier.
 */
function calculateTierWeight(tier: HopDecayTier, hops: number): number {
  if (hops < tier.holdHops) {
    return tier.initialWeight;
  }

  const decayHops = hops - tier.holdHops;
  return Math.max(0, tier.initialWeight - tier.decayPerHop * decayHops);
}

/**
 * Get the hop count where weight reaches zero (or null if asymptotic).
 */
export function getDeathHops(config: HopDecayConfig): number | null {
  switch (config.type) {
    case 'exponential':
      // Asymptotic - never reaches zero
      return null;

    case 'linear': {
      const w0 = config.initialWeight;
      const rate = config.decayPerHop ?? 0.1;
      if (rate <= 0) return null;
      return Math.ceil(w0 / rate);
    }

    case 'delayed-linear': {
      const w0 = config.initialWeight;
      const hold = config.holdHops ?? 0;
      const rate = config.decayPerHop ?? 0.1;
      if (rate <= 0) return null;
      return hold + Math.ceil(w0 / rate);
    }

    case 'multi-linear': {
      const tiers = config.tiers ?? [];
      if (tiers.length === 0) return 0;
      // Find the tier that dies last
      let maxDeathHops = 0;
      for (const tier of tiers) {
        if (tier.decayPerHop <= 0) return null;
        const deathHops = tier.holdHops + Math.ceil(tier.initialWeight / tier.decayPerHop);
        maxDeathHops = Math.max(maxDeathHops, deathHops);
      }
      return maxDeathHops;
    }

    default:
      return null;
  }
}
