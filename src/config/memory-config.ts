/**
 * Centralized configuration for the Causantic Memory System.
 */

/**
 * Complete memory system configuration.
 */
export interface MemoryConfig {
  // Clustering
  /** Angular distance threshold for assigning chunks to clusters */
  clusterThreshold: number;
  /** HDBSCAN minimum cluster size */
  minClusterSize: number;

  // Chain walking
  /** Maximum chain walking depth */
  maxChainDepth: number;

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
  };

  /** MMR (Maximal Marginal Relevance) reranking configuration */
  mmrReranking: {
    /** 0 = pure diversity, 1 = pure relevance. Default: 0.7 */
    lambda: number;
  };

  // Storage
  /** Path to SQLite database file */
  dbPath: string;
  /** Path to LanceDB vector store directory */
  vectorStorePath: string;
}

/**
 * Default configuration values.
 * Cluster threshold: 0.10 balances coverage and separation on large collections.
 * Phase 0.1 calibrated F1=0.940 at 0.09; bumped to 0.10 after noise rescue
 * pass doubled cluster coverage (26% → 50%) on a 7k-chunk dataset.
 */
export const DEFAULT_CONFIG: MemoryConfig = {
  // Clustering
  clusterThreshold: 0.1,
  minClusterSize: 4,

  // Chain walking
  maxChainDepth: 50, // Safety net for chain walk depth

  // Integration
  claudeMdBudgetTokens: 500,
  mcpMaxResponseTokens: 20000,

  // LLM refresh
  clusterRefreshModel: 'claude-3-haiku-20240307',
  refreshRateLimitPerMin: 30, // Haiku can handle much higher rates

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
  },
  mmrReranking: {
    lambda: 0.7,
  },

  // Storage - defaults to ~/.causantic/
  dbPath: '~/.causantic/memory.db',
  vectorStorePath: '~/.causantic/vectors',
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
  if (config.maxChainDepth < 1) {
    errors.push('maxChainDepth must be at least 1');
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
