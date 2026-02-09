/**
 * Configuration loader with priority-based resolution.
 *
 * Priority (highest to lowest):
 * 1. CLI flags (passed directly)
 * 2. Environment variables (ECM_*)
 * 3. Project config file (./ecm.config.json)
 * 4. User config file (~/.ecm/config.json)
 * 5. Built-in defaults
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePath } from './memory-config.js';

/** External config file structure (matches config.schema.json) */
export interface ExternalConfig {
  decay?: {
    backward?: {
      type?: 'linear' | 'exponential' | 'delayed-linear';
      diesAtHops?: number;
      holdHops?: number;
    };
    forward?: {
      type?: 'linear' | 'exponential' | 'delayed-linear';
      diesAtHops?: number;
      holdHops?: number;
    };
  };
  clustering?: {
    threshold?: number;
    minClusterSize?: number;
  };
  traversal?: {
    maxDepth?: number;
    minWeight?: number;
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
}

/** Default external config values */
const EXTERNAL_DEFAULTS: Required<ExternalConfig> = {
  decay: {
    backward: {
      type: 'linear',
      diesAtHops: 10,
      holdHops: 0,
    },
    forward: {
      type: 'delayed-linear',
      diesAtHops: 20,
      holdHops: 5,
    },
  },
  clustering: {
    threshold: 0.09,
    minClusterSize: 4,
  },
  traversal: {
    maxDepth: 5,
    minWeight: 0.01,
  },
  tokens: {
    claudeMdBudget: 500,
    mcpMaxResponse: 2000,
  },
  storage: {
    dbPath: '~/.ecm/memory.db',
    vectorPath: '~/.ecm/vectors',
  },
  llm: {
    clusterRefreshModel: 'claude-3-haiku-20240307',
    refreshRateLimitPerMin: 30,
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
    console.warn(`Warning: Failed to parse config file ${path}:`, error);
    return null;
  }
}

/**
 * Load config from environment variables.
 * Variables are prefixed with ECM_ and use underscores for nesting.
 * Examples:
 *   ECM_DECAY_BACKWARD_TYPE=linear
 *   ECM_CLUSTERING_THRESHOLD=0.09
 *   ECM_STORAGE_DB_PATH=~/.ecm/memory.db
 */
function loadEnvConfig(): ExternalConfig {
  const config: ExternalConfig = {};

  // Decay backward
  if (process.env.ECM_DECAY_BACKWARD_TYPE) {
    config.decay = config.decay ?? {};
    config.decay.backward = config.decay.backward ?? {};
    config.decay.backward.type = process.env.ECM_DECAY_BACKWARD_TYPE as 'linear' | 'exponential' | 'delayed-linear';
  }
  if (process.env.ECM_DECAY_BACKWARD_DIES_AT_HOPS) {
    config.decay = config.decay ?? {};
    config.decay.backward = config.decay.backward ?? {};
    config.decay.backward.diesAtHops = parseInt(process.env.ECM_DECAY_BACKWARD_DIES_AT_HOPS, 10);
  }
  if (process.env.ECM_DECAY_BACKWARD_HOLD_HOPS) {
    config.decay = config.decay ?? {};
    config.decay.backward = config.decay.backward ?? {};
    config.decay.backward.holdHops = parseInt(process.env.ECM_DECAY_BACKWARD_HOLD_HOPS, 10);
  }

  // Decay forward
  if (process.env.ECM_DECAY_FORWARD_TYPE) {
    config.decay = config.decay ?? {};
    config.decay.forward = config.decay.forward ?? {};
    config.decay.forward.type = process.env.ECM_DECAY_FORWARD_TYPE as 'linear' | 'exponential' | 'delayed-linear';
  }
  if (process.env.ECM_DECAY_FORWARD_DIES_AT_HOPS) {
    config.decay = config.decay ?? {};
    config.decay.forward = config.decay.forward ?? {};
    config.decay.forward.diesAtHops = parseInt(process.env.ECM_DECAY_FORWARD_DIES_AT_HOPS, 10);
  }
  if (process.env.ECM_DECAY_FORWARD_HOLD_HOPS) {
    config.decay = config.decay ?? {};
    config.decay.forward = config.decay.forward ?? {};
    config.decay.forward.holdHops = parseInt(process.env.ECM_DECAY_FORWARD_HOLD_HOPS, 10);
  }

  // Clustering
  if (process.env.ECM_CLUSTERING_THRESHOLD) {
    config.clustering = config.clustering ?? {};
    config.clustering.threshold = parseFloat(process.env.ECM_CLUSTERING_THRESHOLD);
  }
  if (process.env.ECM_CLUSTERING_MIN_CLUSTER_SIZE) {
    config.clustering = config.clustering ?? {};
    config.clustering.minClusterSize = parseInt(process.env.ECM_CLUSTERING_MIN_CLUSTER_SIZE, 10);
  }

  // Traversal
  if (process.env.ECM_TRAVERSAL_MAX_DEPTH) {
    config.traversal = config.traversal ?? {};
    config.traversal.maxDepth = parseInt(process.env.ECM_TRAVERSAL_MAX_DEPTH, 10);
  }
  if (process.env.ECM_TRAVERSAL_MIN_WEIGHT) {
    config.traversal = config.traversal ?? {};
    config.traversal.minWeight = parseFloat(process.env.ECM_TRAVERSAL_MIN_WEIGHT);
  }

  // Tokens
  if (process.env.ECM_TOKENS_CLAUDE_MD_BUDGET) {
    config.tokens = config.tokens ?? {};
    config.tokens.claudeMdBudget = parseInt(process.env.ECM_TOKENS_CLAUDE_MD_BUDGET, 10);
  }
  if (process.env.ECM_TOKENS_MCP_MAX_RESPONSE) {
    config.tokens = config.tokens ?? {};
    config.tokens.mcpMaxResponse = parseInt(process.env.ECM_TOKENS_MCP_MAX_RESPONSE, 10);
  }

  // Storage
  if (process.env.ECM_STORAGE_DB_PATH) {
    config.storage = config.storage ?? {};
    config.storage.dbPath = process.env.ECM_STORAGE_DB_PATH;
  }
  if (process.env.ECM_STORAGE_VECTOR_PATH) {
    config.storage = config.storage ?? {};
    config.storage.vectorPath = process.env.ECM_STORAGE_VECTOR_PATH;
  }

  // LLM
  if (process.env.ECM_LLM_CLUSTER_REFRESH_MODEL) {
    config.llm = config.llm ?? {};
    config.llm.clusterRefreshModel = process.env.ECM_LLM_CLUSTER_REFRESH_MODEL;
  }
  if (process.env.ECM_LLM_REFRESH_RATE_LIMIT) {
    config.llm = config.llm ?? {};
    config.llm.refreshRateLimitPerMin = parseInt(process.env.ECM_LLM_REFRESH_RATE_LIMIT, 10);
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

  // Decay validation
  if (config.decay?.backward?.diesAtHops !== undefined) {
    if (config.decay.backward.diesAtHops < 1) {
      errors.push('decay.backward.diesAtHops must be at least 1');
    }
  }
  if (config.decay?.forward?.diesAtHops !== undefined) {
    if (config.decay.forward.diesAtHops < 1) {
      errors.push('decay.forward.diesAtHops must be at least 1');
    }
  }

  // Traversal validation
  if (config.traversal?.maxDepth !== undefined) {
    if (config.traversal.maxDepth < 1) {
      errors.push('traversal.maxDepth must be at least 1');
    }
  }
  if (config.traversal?.minWeight !== undefined) {
    if (config.traversal.minWeight < 0 || config.traversal.minWeight > 1) {
      errors.push('traversal.minWeight must be between 0 and 1');
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
 * 2. Environment variables (ECM_*)
 * 3. Project config file (./ecm.config.json)
 * 4. User config file (~/.ecm/config.json)
 * 5. Built-in defaults
 */
export function loadConfig(options: LoadConfigOptions = {}): Required<ExternalConfig> {
  let config: ExternalConfig = { ...EXTERNAL_DEFAULTS };

  // 5. Start with defaults (already done)

  // 4. User config file
  if (!options.skipUserConfig) {
    const userConfigPath = options.userConfigPath ?? '~/.ecm/config.json';
    const userConfig = loadConfigFile(userConfigPath);
    if (userConfig) {
      config = deepMerge(config, userConfig);
    }
  }

  // 3. Project config file
  if (!options.skipProjectConfig) {
    const projectConfigPath = options.projectConfigPath ?? join(process.cwd(), 'ecm.config.json');
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

// Re-export for convenience
export { EXTERNAL_DEFAULTS };
