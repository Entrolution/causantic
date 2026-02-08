/**
 * Types for vector decay shape experiments.
 *
 * Tests different decay curve shapes using hop count (D-T-D cycles)
 * instead of wall-clock time.
 */

import type { VectorClock } from '../../../temporal/vector-clock.js';

/**
 * Decay curve types for hop-based decay.
 */
export type HopDecayType = 'exponential' | 'linear' | 'delayed-linear' | 'multi-linear';

/**
 * Configuration for hop-based decay curves.
 */
export interface HopDecayConfig {
  id: string;
  name: string;
  type: HopDecayType;
  /** Initial weight at hop 0 */
  initialWeight: number;
  /** For exponential: weight multiplier per hop (e.g., 0.8) */
  weightPerHop?: number;
  /** For linear/delayed-linear: weight reduction per hop */
  decayPerHop?: number;
  /** For delayed-linear: number of hops before decay starts */
  holdHops?: number;
  /** For multi-linear: multiple tiers */
  tiers?: HopDecayTier[];
  /** Minimum weight before considered dead */
  minWeight: number;
}

/**
 * A tier in multi-linear hop decay.
 */
export interface HopDecayTier {
  name: string;
  initialWeight: number;
  holdHops: number;
  decayPerHop: number;
}

/**
 * Result for a single query evaluation.
 */
export interface HopQueryEvaluation {
  sourceChunkId: string;
  projectSlug: string;
  /** Hop distances of relevant (positive) edges */
  relevantHops: number[];
  /** All candidate hop distances */
  allHops: number[];
  reciprocalRank: number;
  firstRelevantRank: number;
  /** Direction of traversal */
  direction: 'backward' | 'forward';
}

/**
 * Result for a decay shape experiment.
 */
export interface HopDecayShapeResult {
  configId: string;
  configName: string;
  direction: 'backward' | 'forward';
  mrr: number;
  queryCount: number;
  rankDistribution: {
    rank1: number;
    rank2_5: number;
    rank6_10: number;
    rank11_plus: number;
  };
  stratifiedMRR: {
    near: number;   // 1-3 hops
    medium: number; // 4-7 hops
    far: number;    // 8+ hops
  };
  stratifiedCounts: {
    near: number;
    medium: number;
    far: number;
  };
}

/**
 * Combined results for all shapes.
 */
export interface HopDecayShapeResults {
  generatedAt: string;
  edgeCount: number;
  results: HopDecayShapeResult[];
  bestBackwardId: string;
  bestForwardId: string;
  bestFarBackwardId: string;
  bestFarForwardId: string;
}

/**
 * Hop bin boundaries.
 */
export const HOP_BIN_BOUNDARIES = {
  near: { min: 0, max: 3 },
  medium: { min: 4, max: 7 },
  far: { min: 8, max: Infinity },
};

export type HopBin = 'near' | 'medium' | 'far';
