/**
 * Centralized configuration for the D-T-D memory system.
 */

import type { DecayModelConfig } from '../core/decay-types.js';
import { MS_PER_MINUTE, MS_PER_HOUR } from '../core/decay-types.js';
import { type VectorDecayConfig, DEFAULT_VECTOR_DECAY } from '../storage/decay.js';

/**
 * Short-range decay: 15min hold, optimized for immediate context recall.
 * Best overall MRR (0.492) - good for recent references.
 */
export const DECAY_SHORT_RANGE: DecayModelConfig = {
  id: 'delayed-linear-15min',
  name: 'Short-Range (15min hold)',
  description: 'Optimized for immediate context - 15min hold, then decay',
  type: 'delayed-linear',
  initialWeight: 1.0,
  holdPeriodMs: 15 * MS_PER_MINUTE,
  decayRate: 1.0 / (2 * MS_PER_HOUR),
};

/**
 * Long-range decay: 60min hold, optimized for distant context recall.
 * Best long-range MRR (0.560 for >3 turns) - good for cross-session memory.
 */
export const DECAY_LONG_RANGE: DecayModelConfig = {
  id: 'delayed-linear-60min',
  name: 'Long-Range (60min hold)',
  description: 'Optimized for distant context - 60min hold, then slower decay',
  type: 'delayed-linear',
  initialWeight: 1.0,
  holdPeriodMs: 60 * MS_PER_MINUTE,
  decayRate: 1.0 / (3 * MS_PER_HOUR), // Slower decay for long-range
};

/** @deprecated Use DECAY_SHORT_RANGE or DECAY_LONG_RANGE */
export const DELAYED_LINEAR_30MIN: DecayModelConfig = {
  id: 'delayed-linear-30min',
  name: 'Delayed Linear (30min hold)',
  description: 'Full weight for 30 minutes, then linear decay over 2 hours',
  type: 'delayed-linear',
  initialWeight: 1.0,
  holdPeriodMs: 30 * MS_PER_MINUTE,
  decayRate: 1.0 / (2 * MS_PER_HOUR),
};

/**
 * Exponential decay with 10-minute half-life.
 * Used for forward (prediction) edges.
 */
export const EXPONENTIAL_10MIN: DecayModelConfig = {
  id: 'exponential-10min',
  name: 'Exponential (10min half-life)',
  description: 'Exponential decay with 10-minute half-life for prediction',
  type: 'exponential',
  initialWeight: 1.0,
  decayRate: Math.log(2) / (10 * MS_PER_MINUTE),
};

/**
 * Complete memory system configuration.
 */
export interface MemoryConfig {
  // Clustering
  /** Angular distance threshold for assigning chunks to clusters */
  clusterThreshold: number;
  /** HDBSCAN minimum cluster size */
  minClusterSize: number;

  // Time-based decay (fallback for edges without vector clocks)
  /** Decay model for short-range backward retrieval (recent context) */
  shortRangeDecay: DecayModelConfig;
  /** Decay model for long-range backward retrieval (distant context) */
  longRangeDecay: DecayModelConfig;
  /** Decay model for forward (prediction) edges */
  forwardDecay: DecayModelConfig;
  /**
   * Legacy exponential vector decay (used by older experiment code).
   * @deprecated Direction-specific hop decay is now automatic:
   * - Backward: Linear (dies@10) for 4-20 hop range
   * - Forward: Delayed linear (5h, dies@20) for 1-20 hop range
   * See src/storage/decay.ts BACKWARD_HOP_DECAY and FORWARD_HOP_DECAY
   */
  vectorDecay: VectorDecayConfig;

  // Traversal
  /** Maximum graph traversal depth */
  maxTraversalDepth: number;
  /** Minimum signal threshold for traversal */
  minSignalThreshold: number;

  // Integration
  /** Token budget for CLAUDE.md memory section */
  claudeMdBudgetTokens: number;
  /** Maximum tokens for MCP tool responses */
  mcpMaxResponseTokens: number;

  // LLM refresh
  /** Model to use for cluster description refresh */
  clusterRefreshModel: string;
  /** Rate limit for refresh calls (per minute) */
  refreshRateLimitPerMin: number;

  // Hybrid search
  /** Configuration for hybrid BM25 + vector search */
  hybridSearch: {
    /** RRF constant (default: 60) */
    rrfK: number;
    /** Weight for vector results in RRF */
    vectorWeight: number;
    /** Weight for keyword results in RRF */
    keywordWeight: number;
    /** Max keyword results before fusion */
    keywordSearchLimit: number;
  };

  /** Configuration for cluster expansion during retrieval */
  clusterExpansion: {
    /** Max clusters to expand from */
    maxClusters: number;
    /** Max siblings per cluster */
    maxSiblings: number;
    /** Score multiplier for cluster siblings */
    boostFactor: number;
  };

  // Storage
  /** Path to SQLite database file */
  dbPath: string;
  /** Path to LanceDB vector store directory */
  vectorStorePath: string;
}

/**
 * Default configuration values.
 * Cluster threshold derived from Phase 0.1 experiment: 0.09 gives F1=0.940
 * (100% precision, 88.7% recall on same-cluster pair prediction)
 */
export const DEFAULT_CONFIG: MemoryConfig = {
  // Clustering
  clusterThreshold: 0.09,
  minClusterSize: 4,

  // Time-based decay (fallback) - based on Phase 0.2 experiment results
  shortRangeDecay: DECAY_SHORT_RANGE,  // 15min hold, best for recent (MRR=0.492)
  longRangeDecay: DECAY_LONG_RANGE,    // 60min hold, best for distant (MRR=0.560)
  forwardDecay: EXPONENTIAL_10MIN,
  // Direction-specific hop decay is now automatic (see decay.ts):
  // - Backward: Linear (dies@10) - MRR=0.688 (+35% vs exponential)
  // - Forward: Delayed (5h, dies@20) - MRR=0.849 (+271% vs exponential)
  vectorDecay: DEFAULT_VECTOR_DECAY,   // Legacy fallback only

  // Traversal
  maxTraversalDepth: 20,  // Match forward decay diesAtHops
  minSignalThreshold: 0.01,

  // Integration
  claudeMdBudgetTokens: 500,
  mcpMaxResponseTokens: 2000,

  // LLM refresh
  clusterRefreshModel: 'claude-3-haiku-20240307',
  refreshRateLimitPerMin: 30,  // Haiku can handle much higher rates

  // Hybrid search
  hybridSearch: {
    rrfK: 60,
    vectorWeight: 1.0,
    keywordWeight: 1.0,
    keywordSearchLimit: 20,
  },
  clusterExpansion: {
    maxClusters: 3,
    maxSiblings: 5,
    boostFactor: 0.3,
  },

  // Storage - defaults to ~/.ecm/
  dbPath: '~/.ecm/memory.db',
  vectorStorePath: '~/.ecm/vectors',
};

/**
 * Get configuration with overrides applied.
 */
export function getConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Resolve ~ to home directory in paths.
 */
export function resolvePath(path: string): string {
  if (path.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.replace('~', home);
  }
  return path;
}

/**
 * Validate configuration values.
 */
export function validateConfig(config: MemoryConfig): string[] {
  const errors: string[] = [];

  if (config.clusterThreshold <= 0 || config.clusterThreshold >= 1) {
    errors.push('clusterThreshold must be between 0 and 1 (exclusive)');
  }
  if (config.minClusterSize < 2) {
    errors.push('minClusterSize must be at least 2');
  }
  if (config.maxTraversalDepth < 1) {
    errors.push('maxTraversalDepth must be at least 1');
  }
  if (config.minSignalThreshold < 0 || config.minSignalThreshold > 1) {
    errors.push('minSignalThreshold must be between 0 and 1');
  }
  if (config.claudeMdBudgetTokens < 100) {
    errors.push('claudeMdBudgetTokens should be at least 100');
  }
  if (config.mcpMaxResponseTokens < 500) {
    errors.push('mcpMaxResponseTokens should be at least 500');
  }
  if (config.refreshRateLimitPerMin < 0) {
    errors.push('refreshRateLimitPerMin cannot be negative');
  }

  return errors;
}

/**
 * Hold period variants for Phase 0 experiments.
 */
export const HOLD_PERIOD_VARIANTS: DecayModelConfig[] = [
  {
    id: 'delayed-linear-15min',
    name: 'Delayed Linear (15min hold)',
    description: 'Full weight for 15 minutes, then linear decay over 2 hours',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 15 * MS_PER_MINUTE,
    decayRate: 1.0 / (2 * MS_PER_HOUR),
  },
  DELAYED_LINEAR_30MIN,
  {
    id: 'delayed-linear-45min',
    name: 'Delayed Linear (45min hold)',
    description: 'Full weight for 45 minutes, then linear decay over 2 hours',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 45 * MS_PER_MINUTE,
    decayRate: 1.0 / (2 * MS_PER_HOUR),
  },
  {
    id: 'delayed-linear-60min',
    name: 'Delayed Linear (60min hold)',
    description: 'Full weight for 60 minutes, then linear decay over 2 hours',
    type: 'delayed-linear',
    initialWeight: 1.0,
    holdPeriodMs: 60 * MS_PER_MINUTE,
    decayRate: 1.0 / (2 * MS_PER_HOUR),
  },
];
