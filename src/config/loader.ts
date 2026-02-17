/**
 * Configuration loader with priority-based resolution.
 *
 * Priority (highest to lowest):
 * 1. CLI flags (passed directly)
 * 2. Environment variables (CAUSANTIC_*)
 * 3. Project config file (./causantic.config.json)
 * 4. User config file (~/.causantic/config.json)
 * 5. Built-in defaults
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePath, DEFAULT_CONFIG, type MemoryConfig } from './memory-config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config-loader');

/** External config file structure (matches config.schema.json) */
export interface ExternalConfig {
  clustering?: {
    threshold?: number;
    minClusterSize?: number;
  };
  traversal?: {
    maxDepth?: number;
  };
  tokens?: {
    claudeMdBudget?: number;
    mcpMaxResponse?: number;
  };
  storage?: {
    dbPath?: string;
    vectorPath?: string;
  };
  llm?: {
    clusterRefreshModel?: string;
    refreshRateLimitPerMin?: number;
  };
  encryption?: {
    enabled?: boolean;
    cipher?: 'chacha20' | 'sqlcipher';
    keySource?: 'keychain' | 'env' | 'prompt';
    auditLog?: boolean;
  };
  vectors?: {
    /** TTL in days for vectors. Vectors accessed within this period are kept. Default: 90 */
    ttlDays?: number;
    /** Maximum number of vectors to keep. Oldest by last_accessed are evicted. 0 = unlimited. Default: 0 */
    maxCount?: number;
  };
  embedding?: {
    /** Device for embedding inference: 'auto' | 'coreml' | 'cuda' | 'cpu' | 'wasm'. Default: 'auto'. */
    device?: string;
  };
  maintenance?: {
    /** Hour of day (0-23) to run reclustering. Default: 2. */
    clusterHour?: number;
  };
  retrieval?: {
    /** MMR lambda: 0 = pure diversity, 1 = pure relevance. Default: 0.7 */
    mmrLambda?: number;
  };
}

/** Default external config values */
const EXTERNAL_DEFAULTS: Required<ExternalConfig> = {
  clustering: {
    threshold: 0.1,
    minClusterSize: 4,
  },
  traversal: {
    maxDepth: 50, // Safety net for chain walk depth
  },
  tokens: {
    claudeMdBudget: 500,
    mcpMaxResponse: 20000,
  },
  storage: {
    dbPath: '~/.causantic/memory.db',
    vectorPath: '~/.causantic/vectors',
  },
  llm: {
    clusterRefreshModel: 'claude-3-haiku-20240307',
    refreshRateLimitPerMin: 30,
  },
  encryption: {
    enabled: false,
    cipher: 'chacha20',
    keySource: 'keychain',
    auditLog: false,
  },
  vectors: {
    ttlDays: 90,
    maxCount: 0,
  },
  embedding: {
    device: 'auto',
  },
  maintenance: {
    clusterHour: 2,
  },
  retrieval: {
    mmrLambda: 0.7,
  },
};

/**
 * Load config from a JSON file.
 */
function loadConfigFile(path: string): ExternalConfig | null {
  const resolvedPath = resolvePath(path);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(content) as ExternalConfig;
  } catch (error) {
    log.warn(`Failed to parse config file ${path}`, { error: (error as Error).message });
    return null;
  }
}

/**
 * Load config from environment variables.
 * Variables are prefixed with CAUSANTIC_ and use underscores for nesting.
 * Examples:
 *   CAUSANTIC_DECAY_BACKWARD_TYPE=linear
 *   CAUSANTIC_CLUSTERING_THRESHOLD=0.09
 *   CAUSANTIC_STORAGE_DB_PATH=~/.causantic/memory.db
 */
function loadEnvConfig(): ExternalConfig {
  const config: ExternalConfig = {};

  // Clustering
  if (process.env.CAUSANTIC_CLUSTERING_THRESHOLD) {
    config.clustering = config.clustering ?? {};
    config.clustering.threshold = parseFloat(process.env.CAUSANTIC_CLUSTERING_THRESHOLD);
  }
  if (process.env.CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE) {
    config.clustering = config.clustering ?? {};
    config.clustering.minClusterSize = parseInt(
      process.env.CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE,
      10,
    );
  }

  // Traversal
  if (process.env.CAUSANTIC_TRAVERSAL_MAX_DEPTH) {
    config.traversal = config.traversal ?? {};
    config.traversal.maxDepth = parseInt(process.env.CAUSANTIC_TRAVERSAL_MAX_DEPTH, 10);
  }

  // Tokens
  if (process.env.CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET) {
    config.tokens = config.tokens ?? {};
    config.tokens.claudeMdBudget = parseInt(process.env.CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET, 10);
  }
  if (process.env.CAUSANTIC_TOKENS_MCP_MAX_RESPONSE) {
    config.tokens = config.tokens ?? {};
    config.tokens.mcpMaxResponse = parseInt(process.env.CAUSANTIC_TOKENS_MCP_MAX_RESPONSE, 10);
  }

  // Storage
  if (process.env.CAUSANTIC_STORAGE_DB_PATH) {
    config.storage = config.storage ?? {};
    config.storage.dbPath = process.env.CAUSANTIC_STORAGE_DB_PATH;
  }
  if (process.env.CAUSANTIC_STORAGE_VECTOR_PATH) {
    config.storage = config.storage ?? {};
    config.storage.vectorPath = process.env.CAUSANTIC_STORAGE_VECTOR_PATH;
  }

  // LLM
  if (process.env.CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL) {
    config.llm = config.llm ?? {};
    config.llm.clusterRefreshModel = process.env.CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL;
  }
  if (process.env.CAUSANTIC_LLM_REFRESH_RATE_LIMIT) {
    config.llm = config.llm ?? {};
    config.llm.refreshRateLimitPerMin = parseInt(process.env.CAUSANTIC_LLM_REFRESH_RATE_LIMIT, 10);
  }

  // Encryption
  if (process.env.CAUSANTIC_ENCRYPTION_ENABLED) {
    config.encryption = config.encryption ?? {};
    config.encryption.enabled = process.env.CAUSANTIC_ENCRYPTION_ENABLED === 'true';
  }
  if (process.env.CAUSANTIC_ENCRYPTION_CIPHER) {
    config.encryption = config.encryption ?? {};
    config.encryption.cipher = process.env.CAUSANTIC_ENCRYPTION_CIPHER as 'chacha20' | 'sqlcipher';
  }
  if (process.env.CAUSANTIC_ENCRYPTION_KEY_SOURCE) {
    config.encryption = config.encryption ?? {};
    config.encryption.keySource = process.env.CAUSANTIC_ENCRYPTION_KEY_SOURCE as
      | 'keychain'
      | 'env'
      | 'prompt';
  }
  if (process.env.CAUSANTIC_ENCRYPTION_AUDIT_LOG) {
    config.encryption = config.encryption ?? {};
    config.encryption.auditLog = process.env.CAUSANTIC_ENCRYPTION_AUDIT_LOG === 'true';
  }

  // Vectors
  if (process.env.CAUSANTIC_VECTORS_TTL_DAYS) {
    config.vectors = config.vectors ?? {};
    config.vectors.ttlDays = parseInt(process.env.CAUSANTIC_VECTORS_TTL_DAYS, 10);
  }
  if (process.env.CAUSANTIC_VECTORS_MAX_COUNT) {
    config.vectors = config.vectors ?? {};
    config.vectors.maxCount = parseInt(process.env.CAUSANTIC_VECTORS_MAX_COUNT, 10);
  }

  // Maintenance
  if (process.env.CAUSANTIC_MAINTENANCE_CLUSTER_HOUR) {
    config.maintenance = config.maintenance ?? {};
    config.maintenance.clusterHour = parseInt(process.env.CAUSANTIC_MAINTENANCE_CLUSTER_HOUR, 10);
  }

  // Embedding
  if (process.env.CAUSANTIC_EMBEDDING_DEVICE) {
    config.embedding = config.embedding ?? {};
    config.embedding.device = process.env.CAUSANTIC_EMBEDDING_DEVICE;
  }

  // Retrieval
  if (process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA) {
    config.retrieval = config.retrieval ?? {};
    config.retrieval.mmrLambda = parseFloat(process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA);
  }

  return config;
}

/**
 * Deep merge two config objects, with source overriding target.
 */
function deepMerge(target: ExternalConfig, source: Partial<ExternalConfig>): ExternalConfig {
  const result = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source) as (keyof ExternalConfig)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = {
        ...(targetValue as Record<string, unknown>),
        ...(sourceValue as Record<string, unknown>),
      };
    } else {
      result[key] = sourceValue;
    }
  }

  return result as ExternalConfig;
}

/**
 * Validate the external config structure.
 */
export function validateExternalConfig(config: ExternalConfig): string[] {
  const errors: string[] = [];

  // Clustering validation
  if (config.clustering?.threshold !== undefined) {
    if (config.clustering.threshold <= 0 || config.clustering.threshold >= 1) {
      errors.push('clustering.threshold must be between 0 and 1 (exclusive)');
    }
  }
  if (config.clustering?.minClusterSize !== undefined) {
    if (config.clustering.minClusterSize < 2) {
      errors.push('clustering.minClusterSize must be at least 2');
    }
  }

  // Traversal validation
  if (config.traversal?.maxDepth !== undefined) {
    if (config.traversal.maxDepth < 1) {
      errors.push('traversal.maxDepth must be at least 1');
    }
  }

  // Token validation
  if (config.tokens?.claudeMdBudget !== undefined) {
    if (config.tokens.claudeMdBudget < 100) {
      errors.push('tokens.claudeMdBudget should be at least 100');
    }
  }
  if (config.tokens?.mcpMaxResponse !== undefined) {
    if (config.tokens.mcpMaxResponse < 500) {
      errors.push('tokens.mcpMaxResponse should be at least 500');
    }
  }

  // Vectors validation
  if (config.vectors?.maxCount !== undefined) {
    if (config.vectors.maxCount < 0) {
      errors.push('vectors.maxCount must be >= 0 (0 = unlimited)');
    }
  }

  // Retrieval validation
  if (config.retrieval?.mmrLambda !== undefined) {
    if (config.retrieval.mmrLambda < 0 || config.retrieval.mmrLambda > 1) {
      errors.push('retrieval.mmrLambda must be between 0 and 1 (inclusive)');
    }
  }

  return errors;
}

export interface LoadConfigOptions {
  /** CLI overrides (highest priority) */
  cliOverrides?: Partial<ExternalConfig>;
  /** Skip loading environment variables */
  skipEnv?: boolean;
  /** Skip loading project config file */
  skipProjectConfig?: boolean;
  /** Skip loading user config file */
  skipUserConfig?: boolean;
  /** Custom project config path */
  projectConfigPath?: string;
  /** Custom user config path */
  userConfigPath?: string;
}

/**
 * Load configuration with priority-based resolution.
 *
 * Priority (highest to lowest):
 * 1. CLI flags (cliOverrides)
 * 2. Environment variables (CAUSANTIC_*)
 * 3. Project config file (./causantic.config.json)
 * 4. User config file (~/.causantic/config.json)
 * 5. Built-in defaults
 */
export function loadConfig(options: LoadConfigOptions = {}): Required<ExternalConfig> {
  let config: ExternalConfig = { ...EXTERNAL_DEFAULTS };

  // 5. Start with defaults (already done)

  // 4. User config file
  if (!options.skipUserConfig) {
    const userConfigPath = options.userConfigPath ?? '~/.causantic/config.json';
    const userConfig = loadConfigFile(userConfigPath);
    if (userConfig) {
      config = deepMerge(config, userConfig);
    }
  }

  // 3. Project config file
  if (!options.skipProjectConfig) {
    const projectConfigPath =
      options.projectConfigPath ?? join(process.cwd(), 'causantic.config.json');
    const projectConfig = loadConfigFile(projectConfigPath);
    if (projectConfig) {
      config = deepMerge(config, projectConfig);
    }
  }

  // 2. Environment variables
  if (!options.skipEnv) {
    const envConfig = loadEnvConfig();
    config = deepMerge(config, envConfig);
  }

  // 1. CLI overrides
  if (options.cliOverrides) {
    config = deepMerge(config, options.cliOverrides);
  }

  return config as Required<ExternalConfig>;
}

/**
 * Get the resolved storage paths.
 */
export function getResolvedPaths(config: Required<ExternalConfig>): {
  dbPath: string;
  vectorPath: string;
} {
  const storage = config.storage ?? EXTERNAL_DEFAULTS.storage;
  const dbPath = storage.dbPath ?? EXTERNAL_DEFAULTS.storage.dbPath;
  const vectorPath = storage.vectorPath ?? EXTERNAL_DEFAULTS.storage.vectorPath;
  return {
    dbPath: resolvePath(dbPath as string),
    vectorPath: resolvePath(vectorPath as string),
  };
}

/**
 * Convert ExternalConfig to MemoryConfig (the runtime format).
 *
 * Maps field names between the two config systems and merges with
 * DEFAULT_CONFIG so callers get a complete MemoryConfig.
 */
export function toRuntimeConfig(external: Required<ExternalConfig>): MemoryConfig {
  return {
    ...DEFAULT_CONFIG,

    // Clustering
    clusterThreshold: external.clustering.threshold ?? DEFAULT_CONFIG.clusterThreshold,
    minClusterSize: external.clustering.minClusterSize ?? DEFAULT_CONFIG.minClusterSize,

    // Chain walking
    maxChainDepth: external.traversal.maxDepth ?? DEFAULT_CONFIG.maxChainDepth,

    // Tokens
    claudeMdBudgetTokens: external.tokens.claudeMdBudget ?? DEFAULT_CONFIG.claudeMdBudgetTokens,
    mcpMaxResponseTokens: external.tokens.mcpMaxResponse ?? DEFAULT_CONFIG.mcpMaxResponseTokens,

    // Storage
    dbPath: external.storage.dbPath ?? DEFAULT_CONFIG.dbPath,
    vectorStorePath: external.storage.vectorPath ?? DEFAULT_CONFIG.vectorStorePath,

    // LLM
    clusterRefreshModel: external.llm.clusterRefreshModel ?? DEFAULT_CONFIG.clusterRefreshModel,
    refreshRateLimitPerMin:
      external.llm.refreshRateLimitPerMin ?? DEFAULT_CONFIG.refreshRateLimitPerMin,

    // Retrieval
    mmrReranking: {
      lambda: external.retrieval?.mmrLambda ?? DEFAULT_CONFIG.mmrReranking.lambda,
    },
  };
}

// Re-export for convenience
export { EXTERNAL_DEFAULTS };
