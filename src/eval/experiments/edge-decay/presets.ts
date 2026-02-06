/**
 * Preset decay model configurations for comparison.
 */

import type { DecayModelConfig, DecayTier } from './types.js';
import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from './types.js';

/**
 * Short-term tier: high weight, fast decay, short hold.
 * Models immediate conversational context.
 */
export const SHORT_TERM_TIER: DecayTier = {
  name: 'short-term',
  initialWeight: 1.0,
  holdPeriodMs: 5 * MS_PER_MINUTE,
  decayRatePerMs: 1.0 / (15 * MS_PER_MINUTE), // Dies ~20 min after hold
};

/**
 * Medium-term tier: moderate weight, moderate decay.
 * Models session-level context.
 */
export const MEDIUM_TERM_TIER: DecayTier = {
  name: 'medium-term',
  initialWeight: 0.5,
  holdPeriodMs: 1 * MS_PER_HOUR,
  decayRatePerMs: 0.5 / (4 * MS_PER_HOUR), // Dies ~5 hours after hold
};

/**
 * Long-term tier: lower weight, slow decay.
 * Models project-level context.
 */
export const LONG_TERM_TIER: DecayTier = {
  name: 'long-term',
  initialWeight: 0.3,
  holdPeriodMs: 24 * MS_PER_HOUR,
  decayRatePerMs: 0.3 / (48 * MS_PER_HOUR), // Dies ~72 hours after hold
};

/**
 * Default three-tier configuration.
 */
export const DEFAULT_TIERS: DecayTier[] = [
  SHORT_TERM_TIER,
  MEDIUM_TERM_TIER,
  LONG_TERM_TIER,
];

/**
 * Alternative: faster decay for ephemeral contexts.
 */
export const FAST_DECAY_TIERS: DecayTier[] = [
  {
    name: 'immediate',
    initialWeight: 1.0,
    holdPeriodMs: 2 * MS_PER_MINUTE,
    decayRatePerMs: 1.0 / (5 * MS_PER_MINUTE),
  },
  {
    name: 'session',
    initialWeight: 0.4,
    holdPeriodMs: 30 * MS_PER_MINUTE,
    decayRatePerMs: 0.4 / (2 * MS_PER_HOUR),
  },
];

/**
 * Alternative: slower decay for persistent knowledge.
 */
export const SLOW_DECAY_TIERS: DecayTier[] = [
  {
    name: 'working',
    initialWeight: 0.8,
    holdPeriodMs: 30 * MS_PER_MINUTE,
    decayRatePerMs: 0.8 / (2 * MS_PER_HOUR),
  },
  {
    name: 'reference',
    initialWeight: 0.5,
    holdPeriodMs: 6 * MS_PER_HOUR,
    decayRatePerMs: 0.5 / (2 * MS_PER_DAY),
  },
  {
    name: 'archival',
    initialWeight: 0.2,
    holdPeriodMs: 3 * MS_PER_DAY,
    decayRatePerMs: 0.2 / (14 * MS_PER_DAY),
  },
];

// ============================================================
// Preset Models for Comparison
// ============================================================

export const PRESET_MODELS: DecayModelConfig[] = [
  // Simple linear
  {
    id: 'linear-simple',
    name: 'Simple Linear',
    description: 'Single linear decay from 1.0, no hold period',
    type: 'linear',
    initialWeight: 1.0,
    decayRate: 1.0 / (2 * MS_PER_HOUR), // Dies at 2 hours
  },

  // Delayed linear
  {
    id: 'delayed-linear',
    name: 'Delayed Linear',
    description: 'Linear decay with 30-minute hold period',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 30 * MS_PER_MINUTE,
    decayRate: 1.0 / (2 * MS_PER_HOUR), // Dies at 2.5 hours
  },

  // Multi-linear default
  {
    id: 'multi-linear-default',
    name: 'Multi-Linear (Default)',
    description: 'Three-tier parallel decay: short/medium/long term',
    type: 'multi-linear',
    tiers: DEFAULT_TIERS,
  },

  // Multi-linear fast
  {
    id: 'multi-linear-fast',
    name: 'Multi-Linear (Fast)',
    description: 'Two-tier fast decay for ephemeral contexts',
    type: 'multi-linear',
    tiers: FAST_DECAY_TIERS,
  },

  // Multi-linear slow
  {
    id: 'multi-linear-slow',
    name: 'Multi-Linear (Slow)',
    description: 'Three-tier slow decay for persistent knowledge',
    type: 'multi-linear',
    tiers: SLOW_DECAY_TIERS,
  },

  // Exponential - matched to multi-linear peak
  {
    id: 'exponential',
    name: 'Exponential',
    description: 'Exponential decay with similar half-life to multi-linear',
    type: 'exponential',
    initialWeight: 1.8, // Match multi-linear peak
    decayRate: Math.log(2) / (1 * MS_PER_HOUR), // Half-life of 1 hour
  },

  // Exponential slow
  {
    id: 'exponential-slow',
    name: 'Exponential (Slow)',
    description: 'Exponential decay with 4-hour half-life',
    type: 'exponential',
    initialWeight: 1.8,
    decayRate: Math.log(2) / (4 * MS_PER_HOUR),
  },

  // Power law
  {
    id: 'power-law',
    name: 'Power Law (α=1)',
    description: 'Power law decay w(t) = w₀/(1+kt), α=1',
    type: 'power-law',
    initialWeight: 1.8,
    decayRate: 1 / MS_PER_HOUR,
    powerExponent: 1.0,
  },

  // Power law with higher exponent
  {
    id: 'power-law-steep',
    name: 'Power Law (α=2)',
    description: 'Steeper power law decay, α=2',
    type: 'power-law',
    initialWeight: 1.8,
    decayRate: 1 / MS_PER_HOUR,
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
