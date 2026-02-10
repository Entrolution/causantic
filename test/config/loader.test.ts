/**
 * Tests for config/loader.ts — configuration loading, defaults, validation, merge, and priority.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, validateExternalConfig, getResolvedPaths, EXTERNAL_DEFAULTS } from '../../src/config/loader.js';
import type { ExternalConfig } from '../../src/config/loader.js';

describe('loadConfig', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear any ECM_ env vars to ensure clean test environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ECM_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ECM_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (key.startsWith('ECM_') && value !== undefined) {
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

      expect(config.decay.backward.type).toBe('linear');
      expect(config.decay.backward.diesAtHops).toBe(10);
      expect(config.decay.forward.type).toBe('delayed-linear');
      expect(config.decay.forward.diesAtHops).toBe(20);
      expect(config.decay.forward.holdHops).toBe(5);
      expect(config.clustering.threshold).toBe(0.09);
      expect(config.clustering.minClusterSize).toBe(4);
      expect(config.traversal.maxDepth).toBe(20);
      expect(config.traversal.minWeight).toBe(0.01);
      expect(config.tokens.claudeMdBudget).toBe(500);
      expect(config.tokens.mcpMaxResponse).toBe(2000);
      expect(config.storage.dbPath).toBe('~/.ecm/memory.db');
      expect(config.storage.vectorPath).toBe('~/.ecm/vectors');
      expect(config.llm.clusterRefreshModel).toBe('claude-3-haiku-20240307');
      expect(config.llm.refreshRateLimitPerMin).toBe(30);
      expect(config.encryption.enabled).toBe(false);
      expect(config.encryption.cipher).toBe('chacha20');
      expect(config.encryption.keySource).toBe('keychain');
      expect(config.encryption.auditLog).toBe(false);
      expect(config.vectors.ttlDays).toBe(90);
      expect(config.embedding.device).toBe('auto');
    });

    it('EXTERNAL_DEFAULTS has all required fields', () => {
      expect(EXTERNAL_DEFAULTS.decay).toBeDefined();
      expect(EXTERNAL_DEFAULTS.clustering).toBeDefined();
      expect(EXTERNAL_DEFAULTS.traversal).toBeDefined();
      expect(EXTERNAL_DEFAULTS.tokens).toBeDefined();
      expect(EXTERNAL_DEFAULTS.storage).toBeDefined();
      expect(EXTERNAL_DEFAULTS.llm).toBeDefined();
      expect(EXTERNAL_DEFAULTS.encryption).toBeDefined();
      expect(EXTERNAL_DEFAULTS.vectors).toBeDefined();
      expect(EXTERNAL_DEFAULTS.embedding).toBeDefined();
    });
  });

  describe('environment variable overrides', () => {
    it('overrides decay backward settings from env', () => {
      process.env.ECM_DECAY_BACKWARD_TYPE = 'exponential';
      process.env.ECM_DECAY_BACKWARD_DIES_AT_HOPS = '5';
      process.env.ECM_DECAY_BACKWARD_HOLD_HOPS = '2';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.decay.backward.type).toBe('exponential');
      expect(config.decay.backward.diesAtHops).toBe(5);
      expect(config.decay.backward.holdHops).toBe(2);
    });

    it('overrides decay forward settings from env', () => {
      process.env.ECM_DECAY_FORWARD_TYPE = 'linear';
      process.env.ECM_DECAY_FORWARD_DIES_AT_HOPS = '15';
      process.env.ECM_DECAY_FORWARD_HOLD_HOPS = '3';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.decay.forward.type).toBe('linear');
      expect(config.decay.forward.diesAtHops).toBe(15);
      expect(config.decay.forward.holdHops).toBe(3);
    });

    it('overrides clustering settings from env', () => {
      process.env.ECM_CLUSTERING_THRESHOLD = '0.15';
      process.env.ECM_CLUSTERING_MIN_CLUSTER_SIZE = '8';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.threshold).toBe(0.15);
      expect(config.clustering.minClusterSize).toBe(8);
    });

    it('overrides traversal settings from env', () => {
      process.env.ECM_TRAVERSAL_MAX_DEPTH = '30';
      process.env.ECM_TRAVERSAL_MIN_WEIGHT = '0.05';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.traversal.maxDepth).toBe(30);
      expect(config.traversal.minWeight).toBe(0.05);
    });

    it('overrides token settings from env', () => {
      process.env.ECM_TOKENS_CLAUDE_MD_BUDGET = '1000';
      process.env.ECM_TOKENS_MCP_MAX_RESPONSE = '5000';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.tokens.claudeMdBudget).toBe(1000);
      expect(config.tokens.mcpMaxResponse).toBe(5000);
    });

    it('overrides storage settings from env', () => {
      process.env.ECM_STORAGE_DB_PATH = '/tmp/test.db';
      process.env.ECM_STORAGE_VECTOR_PATH = '/tmp/vectors';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.storage.dbPath).toBe('/tmp/test.db');
      expect(config.storage.vectorPath).toBe('/tmp/vectors');
    });

    it('overrides LLM settings from env', () => {
      process.env.ECM_LLM_CLUSTER_REFRESH_MODEL = 'claude-3-opus';
      process.env.ECM_LLM_REFRESH_RATE_LIMIT = '10';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.llm.clusterRefreshModel).toBe('claude-3-opus');
      expect(config.llm.refreshRateLimitPerMin).toBe(10);
    });

    it('overrides encryption settings from env', () => {
      process.env.ECM_ENCRYPTION_ENABLED = 'true';
      process.env.ECM_ENCRYPTION_CIPHER = 'sqlcipher';
      process.env.ECM_ENCRYPTION_KEY_SOURCE = 'env';
      process.env.ECM_ENCRYPTION_AUDIT_LOG = 'true';

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
      process.env.ECM_VECTORS_TTL_DAYS = '30';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.vectors.ttlDays).toBe(30);
    });

    it('overrides embedding device from env', () => {
      process.env.ECM_EMBEDDING_DEVICE = 'cpu';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.device).toBe('cpu');
    });

    it('skips env vars when skipEnv is true', () => {
      process.env.ECM_CLUSTERING_THRESHOLD = '0.99';

      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.threshold).toBe(0.09); // Default
    });
  });

  describe('CLI overrides (highest priority)', () => {
    it('CLI overrides take precedence over env vars', () => {
      process.env.ECM_CLUSTERING_THRESHOLD = '0.5';

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
      expect(config.decay.backward.type).toBe('linear');
    });

    it('CLI overrides with nested decay config', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          decay: {
            backward: { diesAtHops: 3 },
          },
        },
      });

      expect(config.decay.backward.diesAtHops).toBe(3);
    });
  });

  describe('config file loading', () => {
    it('handles missing project config gracefully', () => {
      // ecm.config.json doesn't exist in the test directory
      const config = loadConfig({
        skipEnv: true,
        skipUserConfig: true,
        projectConfigPath: '/nonexistent/ecm.config.json',
      });

      // Should still return defaults
      expect(config.clustering.threshold).toBe(0.09);
    });

    it('handles missing user config gracefully', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        userConfigPath: '/nonexistent/config.json',
      });

      expect(config.clustering.threshold).toBe(0.09);
    });
  });
});

describe('validateExternalConfig', () => {
  it('returns empty array for valid config', () => {
    const errors = validateExternalConfig({
      clustering: { threshold: 0.5, minClusterSize: 3 },
      decay: { backward: { diesAtHops: 5 }, forward: { diesAtHops: 10 } },
      traversal: { maxDepth: 10, minWeight: 0.1 },
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

  it('reports decay.backward.diesAtHops too small', () => {
    const errors = validateExternalConfig({
      decay: { backward: { diesAtHops: 0 } },
    });
    expect(errors).toContain('decay.backward.diesAtHops must be at least 1');
  });

  it('reports decay.forward.diesAtHops too small', () => {
    const errors = validateExternalConfig({
      decay: { forward: { diesAtHops: 0 } },
    });
    expect(errors).toContain('decay.forward.diesAtHops must be at least 1');
  });

  it('reports traversal.maxDepth too small', () => {
    const errors = validateExternalConfig({
      traversal: { maxDepth: 0 },
    });
    expect(errors).toContain('traversal.maxDepth must be at least 1');
  });

  it('reports traversal.minWeight out of range (negative)', () => {
    const errors = validateExternalConfig({
      traversal: { minWeight: -0.1 },
    });
    expect(errors).toContain('traversal.minWeight must be between 0 and 1');
  });

  it('reports traversal.minWeight out of range (too high)', () => {
    const errors = validateExternalConfig({
      traversal: { minWeight: 1.5 },
    });
    expect(errors).toContain('traversal.minWeight must be between 0 and 1');
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

    expect(paths.dbPath).toContain('.ecm/memory.db');
    expect(paths.vectorPath).toContain('.ecm/vectors');
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
