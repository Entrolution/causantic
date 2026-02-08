/**
 * Types for vector decay parameter sweep experiment.
 */

import type { VectorDecayConfig } from '../../../storage/decay.js';

/**
 * A single weight-per-hop configuration to test.
 */
export interface VectorDecayVariant {
  /** Unique ID for this variant */
  id: string;
  /** Human-readable name */
  name: string;
  /** The decay configuration */
  config: VectorDecayConfig;
}

/**
 * Hop distance stratification levels.
 */
export type HopBin = 'near' | 'medium' | 'far';

/**
 * Evaluation result for a single query.
 */
export interface VectorQueryEvaluation {
  /** Source chunk ID (the query) */
  sourceChunkId: string;
  /** Project slug */
  projectSlug: string;
  /** Hop counts for relevant edges */
  relevantHops: number[];
  /** Hop counts for all candidate edges */
  allHops: number[];
  /** Reciprocal rank using vector decay */
  reciprocalRank: number;
  /** First relevant rank */
  firstRelevantRank: number;
}

/**
 * Results for a single decay variant.
 */
export interface VectorDecaySweepResult {
  /** Variant ID */
  variantId: string;
  /** Variant name */
  variantName: string;
  /** Weight per hop value */
  weightPerHop: number;
  /** Mean Reciprocal Rank overall */
  mrr: number;
  /** Number of queries evaluated */
  queryCount: number;
  /** Rank distribution */
  rankDistribution: {
    rank1: number;
    rank2_5: number;
    rank6_10: number;
    rank11_plus: number;
  };
  /** MRR stratified by hop distance */
  stratifiedMRR: {
    near: number;    // 1-3 hops
    medium: number;  // 4-7 hops
    far: number;     // 8+ hops
  };
  /** Query count by hop bin */
  stratifiedCounts: {
    near: number;
    medium: number;
    far: number;
  };
}

/**
 * Complete sweep results.
 */
export interface VectorDecaySweepResults {
  /** Timestamp when sweep was run */
  generatedAt: string;
  /** Total edges analyzed */
  edgeCount: number;
  /** Edges with vector clocks */
  edgesWithClocks: number;
  /** Results per variant */
  results: VectorDecaySweepResult[];
  /** Best variant by overall MRR */
  bestVariantId: string;
  /** Best variant for far-hop retrieval */
  bestFarHopVariantId: string;
}

/**
 * Default weight-per-hop values to sweep.
 */
export const WEIGHT_PER_HOP_VALUES = [0.80, 0.85, 0.90, 0.95];

/**
 * Hop bin boundaries.
 */
export const HOP_BIN_BOUNDARIES = {
  near: { min: 1, max: 3 },
  medium: { min: 4, max: 7 },
  far: { min: 8, max: Infinity },
};
