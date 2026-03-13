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

  /** Relevance feedback weight for cluster expansion scoring. Default: 0.1 */
  feedbackWeight: number;

  /** Recency boost configuration for time-decay scoring */
  recency: {
    /** Amplitude of the time-decay boost. Default: 0.3 */
    decayFactor: number;
    /** Half-life in hours for the decay function. Default: 48 */
    halfLifeHours: number;
  };

  /** Length penalty configuration to favour focused chunks over large keyword-rich ones */
  lengthPenalty: {
    /** Enable length penalty. Default: true */
    enabled: boolean;
    /** Reference token count for penalty calculation. Default: 500 */
    referenceTokens: number;
  };

  // Clustering (incremental)
  /** Ratio of new chunks that triggers a full recluster. Default: 0.3 (30%). */
  incrementalClusterThreshold: number;

  // Retrieval strategy
  /** Primary retrieval method. 'keyword' = FTS5 only, 'hybrid' = BM25+vector+RRF. Default: 'keyword'. */
  retrievalPrimary: 'keyword' | 'vector' | 'hybrid';
  /** Use vector search to enrich keyword results when primary is 'keyword'. Default: false. */
  vectorEnrichment: boolean;

  // Embedding
  /** Embedding model ID (from model registry). Default: 'jina-small'. */
  embeddingModel: string;
  /** Embed chunks eagerly during ingestion. When false, chunks stored without vectors. Default: false. */
  embeddingEager: boolean;

  // Storage
  /** Path to SQLite database file */
  dbPath: string;
  /** Path to LanceDB vector store directory */
  vectorStorePath: string;

  // Semantic index
  /** Configuration for the semantic index layer */
  semanticIndex: {
    /** Enable index entry generation. Default: true. */
    enabled: boolean;
    /** Target description length in tokens. Default: 130. */
    targetDescriptionTokens: number;
    /** Max entries per maintenance backfill run. Default: 500. */
    batchRefreshLimit: number;
    /** Use index entries for search when available. Default: true. */
    useForSearch: boolean;
  };

  // Repo map
  /** Configuration for the structural repo map */
  repomap: {
    /** Enable repo map generation. Default: true. */
    enabled: boolean;
    /** Maximum tokens for the repo map output. Default: 1024. */
    maxTokens: number;
    /** Supported language extensions. Default: TS/JS only. */
    languages: string[];
  };
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
  // Relevance feedback
  feedbackWeight: 0.1,

  recency: {
    decayFactor: 0.3,
    halfLifeHours: 48,
  },

  // Length penalty
  lengthPenalty: {
    enabled: true,
    referenceTokens: 500,
  },

  // Clustering (incremental)
  incrementalClusterThreshold: 0.3,

  // Retrieval strategy
  retrievalPrimary: 'hybrid',
  vectorEnrichment: false,

  // Embedding
  embeddingModel: 'jina-small',
  embeddingEager: false,

  // Storage - defaults to ~/.causantic/
  dbPath: '~/.causantic/memory.db',
  vectorStorePath: '~/.causantic/vectors',

  // Semantic index (opt-in — requires eager embedding)
  semanticIndex: {
    enabled: false,
    targetDescriptionTokens: 130,
    batchRefreshLimit: 500,
    useForSearch: true,
  },

  // Repo map
  repomap: {
    enabled: true,
    maxTokens: 1024,
    languages: [
      'typescript',
      'javascript',
      'python',
      'java',
      'c',
      'cpp',
      'rust',
      'go',
      'ruby',
      'c-sharp',
      'php',
      'bash',
      'scala',
      'kotlin',
      'swift',
      'haskell',
      'lua',
      'dart',
      'zig',
      'elixir',
      'perl',
      'r',
    ],
  },
};

/**
 * Cached runtime config, populated by initRuntimeConfig().
 * When set, getConfig() returns this instead of bare defaults,
 * ensuring user config files and env vars are respected.
 */
let _runtimeConfig: MemoryConfig | null = null;

/**
 * Initialize the runtime config cache. Call once at startup (e.g., MCP server start).
 * This ensures getConfig() respects user config files and env vars.
 */
export function initRuntimeConfig(config: MemoryConfig): void {
  _runtimeConfig = config;
}

/**
 * Get configuration with overrides applied.
 * Returns the cached runtime config (from initRuntimeConfig) if available,
 * otherwise falls back to DEFAULT_CONFIG.
 */
export function getConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  const base = _runtimeConfig ?? DEFAULT_CONFIG;
  if (Object.keys(overrides).length === 0) return base;
  return {
    ...base,
    ...overrides,
    // Deep-merge nested objects to prevent shallow spread from destroying them
    hybridSearch: { ...base.hybridSearch, ...overrides.hybridSearch },
    clusterExpansion: { ...base.clusterExpansion, ...overrides.clusterExpansion },
    mmrReranking: { ...base.mmrReranking, ...overrides.mmrReranking },
    recency: { ...base.recency, ...overrides.recency },
    lengthPenalty: { ...base.lengthPenalty, ...overrides.lengthPenalty },
    repomap: {
      ...base.repomap,
      ...overrides.repomap,
      languages: overrides.repomap?.languages ?? base.repomap.languages,
    },
    semanticIndex: { ...base.semanticIndex, ...overrides.semanticIndex },
  };
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
