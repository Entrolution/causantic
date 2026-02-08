/**
 * Preset hop decay configurations for experiments.
 *
 * Translating the time-based findings to hop-based:
 * - 30-min hold period ≈ 3-5 hops (assuming ~6-10 min per D-T-D cycle)
 * - 4-hour decay to death ≈ 20-30 hops
 * - 10-min half-life (exponential) ≈ weightPerHop of 0.85-0.90
 */

import type { HopDecayConfig } from './types.js';

/**
 * Exponential decay variants.
 * Current default: 0.80 weightPerHop
 */
export const EXPONENTIAL_CONFIGS: HopDecayConfig[] = [
  {
    id: 'exp-80',
    name: 'Exponential 80%',
    type: 'exponential',
    initialWeight: 1.0,
    weightPerHop: 0.80,
    minWeight: 0.01,
  },
  {
    id: 'exp-85',
    name: 'Exponential 85%',
    type: 'exponential',
    initialWeight: 1.0,
    weightPerHop: 0.85,
    minWeight: 0.01,
  },
  {
    id: 'exp-90',
    name: 'Exponential 90%',
    type: 'exponential',
    initialWeight: 1.0,
    weightPerHop: 0.90,
    minWeight: 0.01,
  },
];

/**
 * Linear decay variants.
 */
export const LINEAR_CONFIGS: HopDecayConfig[] = [
  {
    id: 'linear-fast',
    name: 'Linear Fast (10 hops)',
    type: 'linear',
    initialWeight: 1.0,
    decayPerHop: 0.1, // Dies at 10 hops
    minWeight: 0.01,
  },
  {
    id: 'linear-medium',
    name: 'Linear Medium (20 hops)',
    type: 'linear',
    initialWeight: 1.0,
    decayPerHop: 0.05, // Dies at 20 hops
    minWeight: 0.01,
  },
  {
    id: 'linear-slow',
    name: 'Linear Slow (50 hops)',
    type: 'linear',
    initialWeight: 1.0,
    decayPerHop: 0.02, // Dies at 50 hops
    minWeight: 0.01,
  },
];

/**
 * Delayed linear variants.
 * Key insight from time-based experiments: hold periods matter for retrieval.
 */
export const DELAYED_LINEAR_CONFIGS: HopDecayConfig[] = [
  {
    id: 'delayed-2-10',
    name: 'Delayed Linear (2h, 10h)',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdHops: 2,
    decayPerHop: 0.1, // Dies 10 hops after hold = 12 total
    minWeight: 0.01,
  },
  {
    id: 'delayed-3-15',
    name: 'Delayed Linear (3h, 15h)',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdHops: 3,
    decayPerHop: 0.066, // Dies ~15 hops after hold = 18 total
    minWeight: 0.01,
  },
  {
    id: 'delayed-5-20',
    name: 'Delayed Linear (5h, 20h)',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdHops: 5,
    decayPerHop: 0.05, // Dies 20 hops after hold = 25 total
    minWeight: 0.01,
  },
  {
    id: 'delayed-5-30',
    name: 'Delayed Linear (5h, 30h)',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdHops: 5,
    decayPerHop: 0.033, // Dies ~30 hops after hold = 35 total
    minWeight: 0.01,
  },
];

/**
 * Multi-linear variants with multiple tiers.
 */
export const MULTI_LINEAR_CONFIGS: HopDecayConfig[] = [
  {
    id: 'multi-default',
    name: 'Multi-Linear Default',
    type: 'multi-linear',
    initialWeight: 1.0,
    tiers: [
      { name: 'short', initialWeight: 0.5, holdHops: 1, decayPerHop: 0.1 },   // Dies at 6 hops
      { name: 'medium', initialWeight: 0.3, holdHops: 5, decayPerHop: 0.05 }, // Dies at 11 hops
      { name: 'long', initialWeight: 0.2, holdHops: 10, decayPerHop: 0.02 },  // Dies at 20 hops
    ],
    minWeight: 0.01,
  },
  {
    id: 'multi-slow',
    name: 'Multi-Linear Slow',
    type: 'multi-linear',
    initialWeight: 1.0,
    tiers: [
      { name: 'short', initialWeight: 0.4, holdHops: 2, decayPerHop: 0.08 },  // Dies at 7 hops
      { name: 'medium', initialWeight: 0.3, holdHops: 8, decayPerHop: 0.03 }, // Dies at 18 hops
      { name: 'long', initialWeight: 0.3, holdHops: 15, decayPerHop: 0.01 },  // Dies at 45 hops
    ],
    minWeight: 0.01,
  },
];

/**
 * All configurations for comprehensive comparison.
 */
export const ALL_HOP_DECAY_CONFIGS: HopDecayConfig[] = [
  ...EXPONENTIAL_CONFIGS,
  ...LINEAR_CONFIGS,
  ...DELAYED_LINEAR_CONFIGS,
  ...MULTI_LINEAR_CONFIGS,
];

/**
 * Subset for quick testing.
 */
export const QUICK_TEST_CONFIGS: HopDecayConfig[] = [
  EXPONENTIAL_CONFIGS[0],  // exp-80 (current default)
  LINEAR_CONFIGS[1],       // linear-medium
  DELAYED_LINEAR_CONFIGS[2], // delayed-5-20
  MULTI_LINEAR_CONFIGS[0], // multi-default
];
