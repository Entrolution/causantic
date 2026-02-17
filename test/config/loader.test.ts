/**
 * Tests for config/loader.ts — configuration loading, defaults, validation, merge, and priority.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  validateExternalConfig,
  getResolvedPaths,
  toRuntimeConfig,
  EXTERNAL_DEFAULTS,
} from '../../src/config/loader.js';
import { DEFAULT_CONFIG } from '../../src/config/memory-config.js';

describe('loadConfig', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear any CAUSANTIC_ env vars to ensure a clean test environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CAUSANTIC_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CAUSANTIC_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (key.startsWith('CAUSANTIC_') && value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  describe('defaults', () => {
    it('returns all default values when no config sources exist', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.threshold).toBe(0.1);
      expect(config.clustering.minClusterSize).toBe(4);
      expect(config.traversal.maxDepth).toBe(50);
      expect(config.tokens.claudeMdBudget).toBe(500);
      expect(config.tokens.mcpMaxResponse).toBe(20000);
      expect(config.storage.dbPath).toBe('~/.causantic/memory.db');
      expect(config.storage.vectorPath).toBe('~/.causantic/vectors');
      expect(config.llm.clusterRefreshModel).toBe('claude-3-haiku-20240307');
      expect(config.llm.refreshRateLimitPerMin).toBe(30);
      expect(config.encryption.enabled).toBe(false);
      expect(config.encryption.cipher).toBe('chacha20');
      expect(config.encryption.keySource).toBe('keychain');
      expect(config.encryption.auditLog).toBe(false);
      expect(config.vectors.ttlDays).toBe(90);
      expect(config.embedding.device).toBe('auto');
      expect(config.retrieval.mmrLambda).toBe(0.7);
    });

    it('EXTERNAL_DEFAULTS has all required fields', () => {
      expect(EXTERNAL_DEFAULTS.clustering).toBeDefined();
      expect(EXTERNAL_DEFAULTS.traversal).toBeDefined();
      expect(EXTERNAL_DEFAULTS.tokens).toBeDefined();
      expect(EXTERNAL_DEFAULTS.storage).toBeDefined();
      expect(EXTERNAL_DEFAULTS.llm).toBeDefined();
      expect(EXTERNAL_DEFAULTS.encryption).toBeDefined();
      expect(EXTERNAL_DEFAULTS.vectors).toBeDefined();
      expect(EXTERNAL_DEFAULTS.embedding).toBeDefined();
      expect(EXTERNAL_DEFAULTS.retrieval).toBeDefined();
    });
  });

  describe('environment variable overrides', () => {
    it('overrides clustering settings from env', () => {
      process.env.CAUSANTIC_CLUSTERING_THRESHOLD = '0.15';
      process.env.CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE = '8';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.threshold).toBe(0.15);
      expect(config.clustering.minClusterSize).toBe(8);
    });

    it('overrides traversal settings from env', () => {
      process.env.CAUSANTIC_TRAVERSAL_MAX_DEPTH = '30';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.traversal.maxDepth).toBe(30);
    });

    it('overrides token settings from env', () => {
      process.env.CAUSANTIC_TOKENS_CLAUDE_MD_BUDGET = '1000';
      process.env.CAUSANTIC_TOKENS_MCP_MAX_RESPONSE = '5000';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.tokens.claudeMdBudget).toBe(1000);
      expect(config.tokens.mcpMaxResponse).toBe(5000);
    });

    it('overrides storage settings from env', () => {
      process.env.CAUSANTIC_STORAGE_DB_PATH = '/tmp/test.db';
      process.env.CAUSANTIC_STORAGE_VECTOR_PATH = '/tmp/vectors';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.storage.dbPath).toBe('/tmp/test.db');
      expect(config.storage.vectorPath).toBe('/tmp/vectors');
    });

    it('overrides LLM settings from env', () => {
      process.env.CAUSANTIC_LLM_CLUSTER_REFRESH_MODEL = 'claude-3-opus';
      process.env.CAUSANTIC_LLM_REFRESH_RATE_LIMIT = '10';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.llm.clusterRefreshModel).toBe('claude-3-opus');
      expect(config.llm.refreshRateLimitPerMin).toBe(10);
    });

    it('overrides encryption settings from env', () => {
      process.env.CAUSANTIC_ENCRYPTION_ENABLED = 'true';
      process.env.CAUSANTIC_ENCRYPTION_CIPHER = 'sqlcipher';
      process.env.CAUSANTIC_ENCRYPTION_KEY_SOURCE = 'env';
      process.env.CAUSANTIC_ENCRYPTION_AUDIT_LOG = 'true';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.encryption.enabled).toBe(true);
      expect(config.encryption.cipher).toBe('sqlcipher');
      expect(config.encryption.keySource).toBe('env');
      expect(config.encryption.auditLog).toBe(true);
    });

    it('overrides vectors TTL from env', () => {
      process.env.CAUSANTIC_VECTORS_TTL_DAYS = '30';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.vectors.ttlDays).toBe(30);
    });

    it('overrides embedding device from env', () => {
      process.env.CAUSANTIC_EMBEDDING_DEVICE = 'cpu';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.device).toBe('cpu');
    });

    it('overrides retrieval MMR lambda from env', () => {
      process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA = '0.5';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.retrieval.mmrLambda).toBe(0.5);
    });

    it('skips env vars when skipEnv is true', () => {
      process.env.CAUSANTIC_CLUSTERING_THRESHOLD = '0.99';

      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.threshold).toBe(0.1); // Default
    });
  });

  describe('CLI overrides (highest priority)', () => {
    it('CLI overrides take precedence over env vars', () => {
      process.env.CAUSANTIC_CLUSTERING_THRESHOLD = '0.5';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          clustering: { threshold: 0.2 },
        },
      });

      expect(config.clustering.threshold).toBe(0.2);
    });

    it('CLI overrides merge with defaults', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          clustering: { threshold: 0.3 },
        },
      });

      expect(config.clustering.threshold).toBe(0.3);
      // Other defaults preserved
      expect(config.clustering.minClusterSize).toBe(4);
    });
  });

  describe('config file loading', () => {
    it('handles missing project config gracefully', () => {
      // causantic.config.json doesn't exist in the test directory
      const config = loadConfig({
        skipEnv: true,
        skipUserConfig: true,
        projectConfigPath: '/nonexistent/causantic.config.json',
      });

      // Should still return defaults
      expect(config.clustering.threshold).toBe(0.1);
    });

    it('handles missing user config gracefully', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        userConfigPath: '/nonexistent/config.json',
      });

      expect(config.clustering.threshold).toBe(0.1);
    });
  });
});

describe('validateExternalConfig', () => {
  it('returns empty array for valid config', () => {
    const errors = validateExternalConfig({
      clustering: { threshold: 0.5, minClusterSize: 3 },
      traversal: { maxDepth: 10 },
      tokens: { claudeMdBudget: 500, mcpMaxResponse: 2000 },
    });

    expect(errors).toEqual([]);
  });

  it('returns empty array for empty config', () => {
    expect(validateExternalConfig({})).toEqual([]);
  });

  it('reports clustering.threshold out of range (too low)', () => {
    const errors = validateExternalConfig({
      clustering: { threshold: 0 },
    });
    expect(errors).toContain('clustering.threshold must be between 0 and 1 (exclusive)');
  });

  it('reports clustering.threshold out of range (too high)', () => {
    const errors = validateExternalConfig({
      clustering: { threshold: 1 },
    });
    expect(errors).toContain('clustering.threshold must be between 0 and 1 (exclusive)');
  });

  it('reports clustering.minClusterSize too small', () => {
    const errors = validateExternalConfig({
      clustering: { minClusterSize: 1 },
    });
    expect(errors).toContain('clustering.minClusterSize must be at least 2');
  });

  it('reports traversal.maxDepth too small', () => {
    const errors = validateExternalConfig({
      traversal: { maxDepth: 0 },
    });
    expect(errors).toContain('traversal.maxDepth must be at least 1');
  });

  it('reports tokens.claudeMdBudget too small', () => {
    const errors = validateExternalConfig({
      tokens: { claudeMdBudget: 50 },
    });
    expect(errors).toContain('tokens.claudeMdBudget should be at least 100');
  });

  it('reports tokens.mcpMaxResponse too small', () => {
    const errors = validateExternalConfig({
      tokens: { mcpMaxResponse: 100 },
    });
    expect(errors).toContain('tokens.mcpMaxResponse should be at least 500');
  });

  it('reports retrieval.mmrLambda out of range (too low)', () => {
    const errors = validateExternalConfig({
      retrieval: { mmrLambda: -0.1 },
    });
    expect(errors).toContain('retrieval.mmrLambda must be between 0 and 1 (inclusive)');
  });

  it('reports retrieval.mmrLambda out of range (too high)', () => {
    const errors = validateExternalConfig({
      retrieval: { mmrLambda: 1.5 },
    });
    expect(errors).toContain('retrieval.mmrLambda must be between 0 and 1 (inclusive)');
  });

  it('accepts valid retrieval.mmrLambda boundary values', () => {
    expect(validateExternalConfig({ retrieval: { mmrLambda: 0 } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { mmrLambda: 1 } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { mmrLambda: 0.7 } })).toEqual([]);
  });

  it('reports multiple errors at once', () => {
    const errors = validateExternalConfig({
      clustering: { threshold: 0, minClusterSize: 1 },
      traversal: { maxDepth: 0 },
    });
    expect(errors).toHaveLength(3);
  });
});

describe('getResolvedPaths', () => {
  it('resolves default paths', () => {
    const config = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const paths = getResolvedPaths(config);

    expect(paths.dbPath).toContain('.causantic/memory.db');
    expect(paths.vectorPath).toContain('.causantic/vectors');
    // Should be absolute paths (tilde resolved)
    expect(paths.dbPath.startsWith('/')).toBe(true);
    expect(paths.vectorPath.startsWith('/')).toBe(true);
  });

  it('resolves custom paths', () => {
    const config = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        storage: {
          dbPath: '/custom/path/memory.db',
          vectorPath: '/custom/path/vectors',
        },
      },
    });

    const paths = getResolvedPaths(config);

    expect(paths.dbPath).toBe('/custom/path/memory.db');
    expect(paths.vectorPath).toBe('/custom/path/vectors');
  });
});

describe('toRuntimeConfig', () => {
  it('maps ExternalConfig field names to MemoryConfig field names', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.maxChainDepth).toBe(external.traversal.maxDepth);
    expect(runtime.clusterThreshold).toBe(external.clustering.threshold);
    expect(runtime.minClusterSize).toBe(external.clustering.minClusterSize);
    expect(runtime.claudeMdBudgetTokens).toBe(external.tokens.claudeMdBudget);
    expect(runtime.mcpMaxResponseTokens).toBe(external.tokens.mcpMaxResponse);
    expect(runtime.dbPath).toBe(external.storage.dbPath);
    expect(runtime.vectorStorePath).toBe(external.storage.vectorPath);
    expect(runtime.clusterRefreshModel).toBe(external.llm.clusterRefreshModel);
    expect(runtime.refreshRateLimitPerMin).toBe(external.llm.refreshRateLimitPerMin);
  });

  it('default-converted config matches DEFAULT_CONFIG', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.maxChainDepth).toBe(DEFAULT_CONFIG.maxChainDepth);
    expect(runtime.clusterThreshold).toBe(DEFAULT_CONFIG.clusterThreshold);
    expect(runtime.minClusterSize).toBe(DEFAULT_CONFIG.minClusterSize);
    expect(runtime.claudeMdBudgetTokens).toBe(DEFAULT_CONFIG.claudeMdBudgetTokens);
    expect(runtime.mcpMaxResponseTokens).toBe(DEFAULT_CONFIG.mcpMaxResponseTokens);
  });

  it('propagates overrides through the full pipeline', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        traversal: { maxDepth: 10 },
        clustering: { threshold: 0.2 },
        tokens: { claudeMdBudget: 1000 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.maxChainDepth).toBe(10);
    expect(runtime.clusterThreshold).toBe(0.2);
    expect(runtime.claudeMdBudgetTokens).toBe(1000);
    // Non-overridden values preserved
    expect(runtime.minClusterSize).toBe(DEFAULT_CONFIG.minClusterSize);
    expect(runtime.mcpMaxResponseTokens).toBe(DEFAULT_CONFIG.mcpMaxResponseTokens);
  });

  it('maps retrieval.mmrLambda to mmrReranking.lambda', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        retrieval: { mmrLambda: 0.5 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.mmrReranking.lambda).toBe(0.5);
  });

  it('defaults mmrReranking.lambda to 0.7', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.mmrReranking.lambda).toBe(0.7);
  });

  it('preserves hybridSearch and clusterExpansion from DEFAULT_CONFIG', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    // hybridSearch and clusterExpansion are MemoryConfig-only, not in ExternalConfig
    expect(runtime.hybridSearch).toEqual(DEFAULT_CONFIG.hybridSearch);
    expect(runtime.clusterExpansion).toEqual(DEFAULT_CONFIG.clusterExpansion);
  });
});
