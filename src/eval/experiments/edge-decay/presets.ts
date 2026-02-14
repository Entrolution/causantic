/**
 * Preset decay model configurations for comparison.
 *
 * Distance metric: hop distance (turn count difference).
 * All parameters are in hops (not milliseconds). The DecayModelConfig
 * field names contain "Ms" for historical reasons, but in this experiment
 * context they represent hop counts.
 *
 * DecayTier.holdPeriodMs  → hold period in hops
 * DecayTier.decayRatePerMs → decay rate per hop
 * DecayModelConfig.holdPeriodMs → hold period in hops
 * DecayModelConfig.decayRate → decay rate per hop
 */

import type { DecayModelConfig, DecayTier } from './types.js';

/**
 * Short-term tier: high weight, fast decay, short hold.
 * Models immediate conversational context (1-5 hops).
 */
export const SHORT_TERM_TIER: DecayTier = {
  name: 'short-term',
  initialWeight: 1.0,
  holdPeriodMs: 1, // Hold for 1 hop
  decayRatePerMs: 1.0 / 4, // Dies 5 hops after creation
};

/**
 * Medium-term tier: moderate weight, moderate decay.
 * Models session-level context (5-20 hops).
 */
export const MEDIUM_TERM_TIER: DecayTier = {
  name: 'medium-term',
  initialWeight: 0.5,
  holdPeriodMs: 5, // Hold for 5 hops
  decayRatePerMs: 0.5 / 15, // Dies ~20 hops after creation
};

/**
 * Long-term tier: lower weight, slow decay.
 * Models project-level context (10-50 hops).
 */
export const LONG_TERM_TIER: DecayTier = {
  name: 'long-term',
  initialWeight: 0.3,
  holdPeriodMs: 10, // Hold for 10 hops
  decayRatePerMs: 0.3 / 40, // Dies ~50 hops after creation
};

/**
 * Default three-tier configuration.
 */
export const DEFAULT_TIERS: DecayTier[] = [SHORT_TERM_TIER, MEDIUM_TERM_TIER, LONG_TERM_TIER];

/**
 * Alternative: faster decay for ephemeral contexts.
 */
export const FAST_DECAY_TIERS: DecayTier[] = [
  {
    name: 'immediate',
    initialWeight: 1.0,
    holdPeriodMs: 0, // No hold
    decayRatePerMs: 1.0 / 3, // Dies at 3 hops
  },
  {
    name: 'session',
    initialWeight: 0.4,
    holdPeriodMs: 2, // Hold for 2 hops
    decayRatePerMs: 0.4 / 8, // Dies at 10 hops
  },
];

/**
 * Alternative: slower decay for persistent knowledge.
 */
export const SLOW_DECAY_TIERS: DecayTier[] = [
  {
    name: 'working',
    initialWeight: 0.8,
    holdPeriodMs: 3, // Hold for 3 hops
    decayRatePerMs: 0.8 / 10, // Dies at 13 hops
  },
  {
    name: 'reference',
    initialWeight: 0.5,
    holdPeriodMs: 10, // Hold for 10 hops
    decayRatePerMs: 0.5 / 30, // Dies at 40 hops
  },
  {
    name: 'archival',
    initialWeight: 0.2,
    holdPeriodMs: 20, // Hold for 20 hops
    decayRatePerMs: 0.2 / 80, // Dies at 100 hops
  },
];

// ============================================================
// Preset Models for Comparison
// ============================================================

export const PRESET_MODELS: DecayModelConfig[] = [
  // Simple linear: dies at 20 hops
  {
    id: 'linear-simple',
    name: 'Simple Linear',
    description: 'Single linear decay from 1.0, dies at 20 hops',
    type: 'linear',
    initialWeight: 1.0,
    decayRate: 1.0 / 20, // Dies at 20 hops
  },

  // Delayed linear: hold 3 hops, then linear decay dies at 23 hops
  {
    id: 'delayed-linear',
    name: 'Delayed Linear',
    description: 'Linear decay with 3-hop hold period, dies at 23 hops',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 3, // Hold for 3 hops
    decayRate: 1.0 / 20, // Dies 20 hops after hold
  },

  // Multi-linear default: three-tier parallel decay
  {
    id: 'multi-linear-default',
    name: 'Multi-Linear (Default)',
    description: 'Three-tier parallel decay: short/medium/long term',
    type: 'multi-linear',
    tiers: DEFAULT_TIERS,
  },

  // Multi-linear fast: two-tier fast decay
  {
    id: 'multi-linear-fast',
    name: 'Multi-Linear (Fast)',
    description: 'Two-tier fast decay for ephemeral contexts',
    type: 'multi-linear',
    tiers: FAST_DECAY_TIERS,
  },

  // Multi-linear slow: three-tier slow decay
  {
    id: 'multi-linear-slow',
    name: 'Multi-Linear (Slow)',
    description: 'Three-tier slow decay for persistent knowledge',
    type: 'multi-linear',
    tiers: SLOW_DECAY_TIERS,
  },

  // Exponential: half-life of 5 hops
  {
    id: 'exponential',
    name: 'Exponential',
    description: 'Exponential decay with 5-hop half-life',
    type: 'exponential',
    initialWeight: 1.8,
    decayRate: Math.log(2) / 5, // Half-life of 5 hops
  },

  // Exponential slow: half-life of 15 hops
  {
    id: 'exponential-slow',
    name: 'Exponential (Slow)',
    description: 'Exponential decay with 15-hop half-life',
    type: 'exponential',
    initialWeight: 1.8,
    decayRate: Math.log(2) / 15,
  },

  // Power law α=1
  {
    id: 'power-law',
    name: 'Power Law (α=1)',
    description: 'Power law decay w(d) = w₀/(1+kd), α=1',
    type: 'power-law',
    initialWeight: 1.8,
    decayRate: 0.2, // At 5 hops: 1.8/2=0.9, at 20 hops: 1.8/5=0.36
    powerExponent: 1.0,
  },

  // Power law α=2 (steeper)
  {
    id: 'power-law-steep',
    name: 'Power Law (α=2)',
    description: 'Steeper power law decay, α=2',
    type: 'power-law',
    initialWeight: 1.8,
    decayRate: 0.2,
    powerExponent: 2.0,
  },
];

/**
 * Get a preset model by ID.
 */
export function getPresetModel(id: string): DecayModelConfig | undefined {
  return PRESET_MODELS.find((m) => m.id === id);
}

/**
 * Get all preset model IDs.
 */
export function getPresetModelIds(): string[] {
  return PRESET_MODELS.map((m) => m.id);
}

/** Alias for PRESET_MODELS */
export const DECAY_MODEL_PRESETS = PRESET_MODELS;

// ============================================================
// Phase 0.2: Hold Period Variants for Parameter Sweep
// ============================================================

/**
 * Hold period variants for finding optimal hold duration (in hops).
 * All use same decay rate after hold period ends.
 */
export const HOLD_PERIOD_VARIANTS: DecayModelConfig[] = [
  {
    id: 'delayed-linear-1hop',
    name: 'Delayed Linear (1 hop)',
    description: 'Linear decay with 1-hop hold period',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 1,
    decayRate: 1.0 / 20,
  },
  {
    id: 'delayed-linear-3hops',
    name: 'Delayed Linear (3 hops)',
    description: 'Linear decay with 3-hop hold period',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 3,
    decayRate: 1.0 / 20,
  },
  {
    id: 'delayed-linear-5hops',
    name: 'Delayed Linear (5 hops)',
    description: 'Linear decay with 5-hop hold period',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 5,
    decayRate: 1.0 / 20,
  },
  {
    id: 'delayed-linear-8hops',
    name: 'Delayed Linear (8 hops)',
    description: 'Linear decay with 8-hop hold period',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 8,
    decayRate: 1.0 / 20,
  },
];

/**
 * Get hold period variant models for parameter sweep.
 */
export function getHoldPeriodVariants(): DecayModelConfig[] {
  return HOLD_PERIOD_VARIANTS;
}
