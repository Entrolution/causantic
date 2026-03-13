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
import { getAllModelIds } from '../models/model-registry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config-loader');

/** External config file structure (matches config.schema.json) */
export interface ExternalConfig {
  clustering?: {
    threshold?: number;
    minClusterSize?: number;
    /** Ratio of new chunks (vs total) that triggers a full recluster. Default: 0.3. */
    incrementalThreshold?: number;
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
    /** Enable LLM-based cluster labelling. Requires Anthropic API key. Default: true. */
    enableLabelling?: boolean;
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
    /** Embedding model ID from model registry. Default: 'jina-small'. */
    model?: string;
    /** Embed chunks eagerly during ingestion. Default: false. */
    eager?: boolean;
  };
  maintenance?: {
    /** Hour of day (0-23) to run reclustering. Default: 2. */
    clusterHour?: number;
  };
  retrieval?: {
    /** MMR lambda: 0 = pure diversity, 1 = pure relevance. Default: 0.7 */
    mmrLambda?: number;
    /** Feedback weight for cluster expansion scoring. Default: 0.1 */
    feedbackWeight?: number;
    /** Primary retrieval method. Default: 'hybrid'. */
    primary?: 'keyword' | 'vector' | 'hybrid';
    /** Use vector search to enrich keyword results when primary is 'keyword'. Default: false. */
    vectorEnrichment?: boolean;
  };
  recency?: {
    /** Amplitude of the time-decay boost (multiplied by exp decay). Default: 0.3 */
    decayFactor?: number;
    /** Half-life in hours for the decay function. Default: 48 */
    halfLifeHours?: number;
  };
  lengthPenalty?: {
    /** Enable length penalty. Default: true */
    enabled?: boolean;
    /** Reference token count for penalty calculation. Must be > 0. Default: 500 */
    referenceTokens?: number;
  };
  semanticIndex?: {
    /** Enable semantic index generation. Default: true. */
    enabled?: boolean;
    /** Target description length in tokens. Default: 130. */
    targetDescriptionTokens?: number;
    /** Max entries to backfill per maintenance run. Default: 500. */
    batchRefreshLimit?: number;
    /** Use index entries for search when available. Default: true. */
    useForSearch?: boolean;
  };
}

/** Default external config values */
const EXTERNAL_DEFAULTS: Required<ExternalConfig> = {
  clustering: {
    threshold: 0.1,
    minClusterSize: 4,
    incrementalThreshold: 0.3,
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
    enableLabelling: true,
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
    model: 'jina-small',
    eager: false,
  },
  maintenance: {
    clusterHour: 2,
  },
  retrieval: {
    mmrLambda: 0.7,
    feedbackWeight: 0.1,
    primary: 'hybrid',
    vectorEnrichment: false,
  },
  recency: {
    decayFactor: 0.3,
    halfLifeHours: 48,
  },
  lengthPenalty: {
    enabled: true,
    referenceTokens: 500,
  },
  semanticIndex: {
    enabled: false,
    targetDescriptionTokens: 130,
    batchRefreshLimit: 500,
    useForSearch: true,
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

/** Mapping from an environment variable to a dot-path in ExternalConfig. */
export type EnvMapping = {
  env: string;
  path: string; // dot-separated path into ExternalConfig
  type: 'string' | 'int' | 'float' | 'boolean';
};

/** All CAUSANTIC_* environment variable mappings. */
export const ENV_MAPPINGS: EnvMapping[] = [
  // Clustering
  { env: 'CAUSANTIC_CLUSTERING_THRESHOLD', path: 'clustering.threshold', type: 'float' },
  { env: 'CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE', path: 'clustering.minClusterSize', type: 'int' },
  {
    env: 'CAUSANTIC_CLUSTERING_INCREMENTAL_THRESHOLD',
    path: 'clustering.incrementalThreshold',
    type: 'float',
  },
  // Traversal
  { env: 'CAUSANTIC_TRAVERSAL_MAX_DEPTH', path: 'traversal.maxDepth', type: 'int' },
  // Tokens
  { env: 'CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET', path: 'tokens.claudeMdBudget', type: 'int' },
  { env: 'CAUSANTIC_TOKENS_MCP_MAX_RESPONSE', path: 'tokens.mcpMaxResponse', type: 'int' },
  // Storage
  { env: 'CAUSANTIC_STORAGE_DB_PATH', path: 'storage.dbPath', type: 'string' },
  { env: 'CAUSANTIC_STORAGE_VECTOR_PATH', path: 'storage.vectorPath', type: 'string' },
  // LLM
  { env: 'CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL', path: 'llm.clusterRefreshModel', type: 'string' },
  { env: 'CAUSANTIC_LLM_REFRESH_RATE_LIMIT', path: 'llm.refreshRateLimitPerMin', type: 'int' },
  { env: 'CAUSANTIC_LLM_ENABLE_LABELLING', path: 'llm.enableLabelling', type: 'boolean' },
  // Encryption
  { env: 'CAUSANTIC_ENCRYPTION_ENABLED', path: 'encryption.enabled', type: 'boolean' },
  { env: 'CAUSANTIC_ENCRYPTION_CIPHER', path: 'encryption.cipher', type: 'string' },
  { env: 'CAUSANTIC_ENCRYPTION_KEY_SOURCE', path: 'encryption.keySource', type: 'string' },
  { env: 'CAUSANTIC_ENCRYPTION_AUDIT_LOG', path: 'encryption.auditLog', type: 'boolean' },
  // Vectors
  { env: 'CAUSANTIC_VECTORS_TTL_DAYS', path: 'vectors.ttlDays', type: 'int' },
  { env: 'CAUSANTIC_VECTORS_MAX_COUNT', path: 'vectors.maxCount', type: 'int' },
  // Maintenance
  { env: 'CAUSANTIC_MAINTENANCE_CLUSTER_HOUR', path: 'maintenance.clusterHour', type: 'int' },
  // Embedding
  { env: 'CAUSANTIC_EMBEDDING_DEVICE', path: 'embedding.device', type: 'string' },
  { env: 'CAUSANTIC_EMBEDDING_MODEL', path: 'embedding.model', type: 'string' },
  { env: 'CAUSANTIC_EMBEDDING_EAGER', path: 'embedding.eager', type: 'boolean' },
  // Retrieval
  { env: 'CAUSANTIC_RETRIEVAL_MMR_LAMBDA', path: 'retrieval.mmrLambda', type: 'float' },
  { env: 'CAUSANTIC_RETRIEVAL_FEEDBACK_WEIGHT', path: 'retrieval.feedbackWeight', type: 'float' },
  { env: 'CAUSANTIC_RETRIEVAL_PRIMARY', path: 'retrieval.primary', type: 'string' },
  {
    env: 'CAUSANTIC_RETRIEVAL_VECTOR_ENRICHMENT',
    path: 'retrieval.vectorEnrichment',
    type: 'boolean',
  },
  // Recency
  { env: 'CAUSANTIC_RECENCY_DECAY_FACTOR', path: 'recency.decayFactor', type: 'float' },
  { env: 'CAUSANTIC_RECENCY_HALF_LIFE_HOURS', path: 'recency.halfLifeHours', type: 'float' },
  // Semantic Index
  { env: 'CAUSANTIC_SEMANTIC_INDEX_ENABLED', path: 'semanticIndex.enabled', type: 'boolean' },
  {
    env: 'CAUSANTIC_SEMANTIC_INDEX_USE_FOR_SEARCH',
    path: 'semanticIndex.useForSearch',
    type: 'boolean',
  },
];

/**
 * Apply environment variable mappings to a config object.
 * Parses values according to their declared type and sets them at the dot-path.
 */
function applyEnvMappings(config: ExternalConfig, mappings: EnvMapping[]): void {
  for (const { env, path, type } of mappings) {
    const value = process.env[env];
    if (value === undefined) continue;

    const parts = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obj: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = obj[parts[i]] ?? {};
      obj = obj[parts[i]];
    }

    const key = parts[parts.length - 1];
    switch (type) {
      case 'int': {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          log.warn(`Invalid integer for ${env}: '${value}'`);
          continue;
        }
        obj[key] = parsed;
        break;
      }
      case 'float': {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) {
          log.warn(`Invalid float for ${env}: '${value}'`);
          continue;
        }
        obj[key] = parsed;
        break;
      }
      case 'boolean':
        obj[key] = value === 'true';
        break;
      case 'string':
        obj[key] = value;
        break;
    }
  }
}

/**
 * Load config from environment variables.
 * Variables are prefixed with CAUSANTIC_ and use underscores for nesting.
 * Examples:
 *   CAUSANTIC_CLUSTERING_THRESHOLD=0.09
 *   CAUSANTIC_STORAGE_DB_PATH=~/.causantic/memory.db
 */
function loadEnvConfig(): ExternalConfig {
  const config: ExternalConfig = {};
  applyEnvMappings(config, ENV_MAPPINGS);
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

  // Embedding validation
  if (config.embedding?.model !== undefined) {
    const validModels = getAllModelIds();
    if (!validModels.includes(config.embedding.model)) {
      errors.push(
        `embedding.model '${config.embedding.model}' is not a registered model. Available: ${validModels.join(', ')}`,
      );
    }
  }

  // Maintenance validation
  if (config.maintenance?.clusterHour !== undefined) {
    if (config.maintenance.clusterHour < 0 || config.maintenance.clusterHour > 23) {
      errors.push('maintenance.clusterHour must be between 0 and 23 (inclusive)');
    }
  }

  // Recency validation
  if (config.recency?.halfLifeHours !== undefined) {
    if (config.recency.halfLifeHours <= 0) {
      errors.push('recency.halfLifeHours must be greater than 0');
    }
  }
  if (config.recency?.decayFactor !== undefined) {
    if (config.recency.decayFactor < 0) {
      errors.push('recency.decayFactor must be >= 0');
    }
  }

  // Length penalty validation
  if (config.lengthPenalty?.referenceTokens !== undefined) {
    if (config.lengthPenalty.referenceTokens <= 0) {
      errors.push('lengthPenalty.referenceTokens must be greater than 0');
    }
  }

  // Retrieval validation
  if (config.retrieval?.primary !== undefined) {
    if (!['keyword', 'vector', 'hybrid'].includes(config.retrieval.primary)) {
      errors.push("retrieval.primary must be 'keyword', 'vector', or 'hybrid'");
    }
  }
  if (config.retrieval?.mmrLambda !== undefined) {
    if (config.retrieval.mmrLambda < 0 || config.retrieval.mmrLambda > 1) {
      errors.push('retrieval.mmrLambda must be between 0 and 1 (inclusive)');
    }
  }
  if (config.retrieval?.feedbackWeight !== undefined) {
    if (config.retrieval.feedbackWeight < 0 || config.retrieval.feedbackWeight > 1) {
      errors.push('retrieval.feedbackWeight must be between 0 and 1 (inclusive)');
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

/** Mapping from an ExternalConfig dot-path to a MemoryConfig dot-path. */
export type ConfigMapping = {
  from: string; // dot-path in ExternalConfig
  to: string; // dot-path in MemoryConfig
};

/** All ExternalConfig -> MemoryConfig field mappings. */
export const CONFIG_MAPPINGS: ConfigMapping[] = [
  // Clustering
  { from: 'clustering.threshold', to: 'clusterThreshold' },
  { from: 'clustering.minClusterSize', to: 'minClusterSize' },
  { from: 'clustering.incrementalThreshold', to: 'incrementalClusterThreshold' },
  // Chain walking
  { from: 'traversal.maxDepth', to: 'maxChainDepth' },
  // Tokens
  { from: 'tokens.claudeMdBudget', to: 'claudeMdBudgetTokens' },
  { from: 'tokens.mcpMaxResponse', to: 'mcpMaxResponseTokens' },
  // Storage
  { from: 'storage.dbPath', to: 'dbPath' },
  { from: 'storage.vectorPath', to: 'vectorStorePath' },
  // LLM
  { from: 'llm.clusterRefreshModel', to: 'clusterRefreshModel' },
  { from: 'llm.refreshRateLimitPerMin', to: 'refreshRateLimitPerMin' },
  // Retrieval strategy
  { from: 'retrieval.primary', to: 'retrievalPrimary' },
  { from: 'retrieval.vectorEnrichment', to: 'vectorEnrichment' },
  // Embedding
  { from: 'embedding.model', to: 'embeddingModel' },
  { from: 'embedding.eager', to: 'embeddingEager' },
  // Retrieval scoring
  { from: 'retrieval.mmrLambda', to: 'mmrReranking.lambda' },
  { from: 'retrieval.feedbackWeight', to: 'feedbackWeight' },
  // Recency
  { from: 'recency.decayFactor', to: 'recency.decayFactor' },
  { from: 'recency.halfLifeHours', to: 'recency.halfLifeHours' },
  // Length penalty
  { from: 'lengthPenalty.enabled', to: 'lengthPenalty.enabled' },
  { from: 'lengthPenalty.referenceTokens', to: 'lengthPenalty.referenceTokens' },
  // Semantic index
  { from: 'semanticIndex.enabled', to: 'semanticIndex.enabled' },
  { from: 'semanticIndex.targetDescriptionTokens', to: 'semanticIndex.targetDescriptionTokens' },
  { from: 'semanticIndex.batchRefreshLimit', to: 'semanticIndex.batchRefreshLimit' },
  { from: 'semanticIndex.useForSearch', to: 'semanticIndex.useForSearch' },
];

/** Read a value from a nested object using a dot-separated path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPath(obj: any, path: string): unknown {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/** Set a value on a nested object using a dot-separated path, creating intermediates as needed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setPath(obj: any, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = current[parts[i]] ?? {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Convert ExternalConfig to MemoryConfig (the runtime format).
 *
 * Maps field names between the two config systems and merges with
 * DEFAULT_CONFIG so callers get a complete MemoryConfig.
 */
export function toRuntimeConfig(external: Required<ExternalConfig>): MemoryConfig {
  // Start with a full copy of defaults
  const runtime: MemoryConfig = {
    ...DEFAULT_CONFIG,
    hybridSearch: { ...DEFAULT_CONFIG.hybridSearch },
    clusterExpansion: { ...DEFAULT_CONFIG.clusterExpansion },
    mmrReranking: { ...DEFAULT_CONFIG.mmrReranking },
    recency: { ...DEFAULT_CONFIG.recency },
    lengthPenalty: { ...DEFAULT_CONFIG.lengthPenalty },
    repomap: { ...DEFAULT_CONFIG.repomap, languages: [...DEFAULT_CONFIG.repomap.languages] },
    semanticIndex: { ...DEFAULT_CONFIG.semanticIndex },
  };

  // Apply table-driven mappings: external value wins over default
  for (const { from, to } of CONFIG_MAPPINGS) {
    const value = getPath(external, from);
    if (value !== null && value !== undefined) {
      setPath(runtime, to, value);
    }
  }

  return runtime;
}

// Re-export for convenience
export { EXTERNAL_DEFAULTS };
