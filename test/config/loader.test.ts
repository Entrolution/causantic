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
      expect(config.llm.enableLabelling).toBe(true);
      expect(config.encryption.enabled).toBe(false);
      expect(config.encryption.cipher).toBe('chacha20');
      expect(config.encryption.keySource).toBe('keychain');
      expect(config.encryption.auditLog).toBe(false);
      expect(config.vectors.ttlDays).toBe(90);
      expect(config.embedding.device).toBe('auto');
      expect(config.retrieval.mmrLambda).toBe(0.7);
      expect(config.retrieval.primary).toBe('hybrid');
      expect(config.retrieval.vectorEnrichment).toBe(false);
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
      expect(EXTERNAL_DEFAULTS.maintenance).toBeDefined();
      expect(EXTERNAL_DEFAULTS.recency).toBeDefined();
      expect(EXTERNAL_DEFAULTS.lengthPenalty).toBeDefined();
      expect(EXTERNAL_DEFAULTS.semanticIndex).toBeDefined();
    });

    it('returns correct defaults for recency, lengthPenalty, semanticIndex, and maintenance', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.recency.decayFactor).toBe(0.3);
      expect(config.recency.halfLifeHours).toBe(48);
      expect(config.lengthPenalty.enabled).toBe(true);
      expect(config.lengthPenalty.referenceTokens).toBe(500);
      expect(config.semanticIndex.enabled).toBe(false);
      expect(config.semanticIndex.targetDescriptionTokens).toBe(130);
      expect(config.semanticIndex.batchRefreshLimit).toBe(500);
      expect(config.semanticIndex.useForSearch).toBe(true);
      expect(config.maintenance.clusterHour).toBe(2);
      expect(config.vectors.maxCount).toBe(0);
      expect(config.embedding.eager).toBe(false);
      expect(config.embedding.model).toBe('jina-small');
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

    it('overrides enableLabelling from env', () => {
      process.env.CAUSANTIC_LLM_ENABLE_LABELLING = 'false';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.llm.enableLabelling).toBe(false);
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

    it('overrides clustering incremental threshold from env', () => {
      process.env.CAUSANTIC_CLUSTERING_INCREMENTAL_THRESHOLD = '0.5';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.incrementalThreshold).toBe(0.5);
    });

    it('overrides vectors maxCount from env', () => {
      process.env.CAUSANTIC_VECTORS_MAX_COUNT = '10000';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.vectors.maxCount).toBe(10000);
    });

    it('overrides maintenance cluster hour from env', () => {
      process.env.CAUSANTIC_MAINTENANCE_CLUSTER_HOUR = '14';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.maintenance.clusterHour).toBe(14);
    });

    it('overrides embedding model from env', () => {
      process.env.CAUSANTIC_EMBEDDING_MODEL = 'jina-code';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.model).toBe('jina-code');
    });

    it('overrides embedding eager from env', () => {
      process.env.CAUSANTIC_EMBEDDING_EAGER = 'true';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.eager).toBe(true);
    });

    it('overrides retrieval feedback weight from env', () => {
      process.env.CAUSANTIC_RETRIEVAL_FEEDBACK_WEIGHT = '0.25';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.retrieval.feedbackWeight).toBe(0.25);
    });

    it('overrides retrieval primary from env', () => {
      process.env.CAUSANTIC_RETRIEVAL_PRIMARY = 'keyword';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.retrieval.primary).toBe('keyword');
    });

    it('overrides retrieval vector enrichment from env', () => {
      process.env.CAUSANTIC_RETRIEVAL_VECTOR_ENRICHMENT = 'true';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.retrieval.vectorEnrichment).toBe(true);
    });

    it('overrides recency decay factor from env', () => {
      process.env.CAUSANTIC_RECENCY_DECAY_FACTOR = '0.6';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.recency.decayFactor).toBe(0.6);
    });

    it('overrides recency half life hours from env', () => {
      process.env.CAUSANTIC_RECENCY_HALF_LIFE_HOURS = '72';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.recency.halfLifeHours).toBe(72);
    });

    it('overrides semantic index enabled from env', () => {
      process.env.CAUSANTIC_SEMANTIC_INDEX_ENABLED = 'true';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.semanticIndex.enabled).toBe(true);
    });

    it('overrides semantic index useForSearch from env', () => {
      process.env.CAUSANTIC_SEMANTIC_INDEX_USE_FOR_SEARCH = 'false';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.semanticIndex.useForSearch).toBe(false);
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

  describe('type coercion edge cases', () => {
    it('parses boolean "true" correctly for all boolean env vars', () => {
      process.env.CAUSANTIC_ENCRYPTION_ENABLED = 'true';
      process.env.CAUSANTIC_ENCRYPTION_AUDIT_LOG = 'true';
      process.env.CAUSANTIC_EMBEDDING_EAGER = 'true';
      process.env.CAUSANTIC_RETRIEVAL_VECTOR_ENRICHMENT = 'true';
      process.env.CAUSANTIC_LLM_ENABLE_LABELLING = 'true';
      process.env.CAUSANTIC_SEMANTIC_INDEX_ENABLED = 'true';
      process.env.CAUSANTIC_SEMANTIC_INDEX_USE_FOR_SEARCH = 'true';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.encryption.enabled).toBe(true);
      expect(config.encryption.auditLog).toBe(true);
      expect(config.embedding.eager).toBe(true);
      expect(config.retrieval.vectorEnrichment).toBe(true);
      expect(config.llm.enableLabelling).toBe(true);
      expect(config.semanticIndex.enabled).toBe(true);
      expect(config.semanticIndex.useForSearch).toBe(true);
    });

    it('parses boolean "false" correctly for all boolean env vars', () => {
      process.env.CAUSANTIC_ENCRYPTION_ENABLED = 'false';
      process.env.CAUSANTIC_ENCRYPTION_AUDIT_LOG = 'false';
      process.env.CAUSANTIC_EMBEDDING_EAGER = 'false';
      process.env.CAUSANTIC_RETRIEVAL_VECTOR_ENRICHMENT = 'false';
      process.env.CAUSANTIC_LLM_ENABLE_LABELLING = 'false';
      process.env.CAUSANTIC_SEMANTIC_INDEX_ENABLED = 'false';
      process.env.CAUSANTIC_SEMANTIC_INDEX_USE_FOR_SEARCH = 'false';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.encryption.enabled).toBe(false);
      expect(config.encryption.auditLog).toBe(false);
      expect(config.embedding.eager).toBe(false);
      expect(config.retrieval.vectorEnrichment).toBe(false);
      expect(config.llm.enableLabelling).toBe(false);
      expect(config.semanticIndex.enabled).toBe(false);
      expect(config.semanticIndex.useForSearch).toBe(false);
    });

    it('treats non-"true" strings as false for boolean env vars', () => {
      process.env.CAUSANTIC_ENCRYPTION_ENABLED = 'yes';
      process.env.CAUSANTIC_EMBEDDING_EAGER = '1';
      process.env.CAUSANTIC_LLM_ENABLE_LABELLING = 'TRUE';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      // Only exact "true" is truthy; everything else is false
      expect(config.encryption.enabled).toBe(false);
      expect(config.embedding.eager).toBe(false);
      expect(config.llm.enableLabelling).toBe(false);
    });

    it('ignores non-numeric strings in integer fields (keeps default)', () => {
      process.env.CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE = 'abc';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      // Non-numeric values are skipped, default is preserved
      expect(config.clustering.minClusterSize).toBe(4);
    });

    it('ignores non-numeric strings in float fields (keeps default)', () => {
      process.env.CAUSANTIC_CLUSTERING_THRESHOLD = 'not-a-number';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      // Non-numeric values are skipped, default is preserved
      expect(config.clustering.threshold).toBe(0.1);
    });

    it('ignores empty string env var (keeps default)', () => {
      process.env.CAUSANTIC_CLUSTERING_THRESHOLD = '';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      // Empty string produces NaN for float → skipped
      expect(config.clustering.threshold).toBe(0.1);
    });

    it('ignores empty string for integer env var (keeps default)', () => {
      process.env.CAUSANTIC_CLUSTERING_MIN_CLUSTER_SIZE = '';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.clustering.minClusterSize).toBe(4);
    });
  });

  describe('validation-guarded env overrides', () => {
    it('rejects clusterHour = -1', () => {
      const errors = validateExternalConfig({ maintenance: { clusterHour: -1 } });
      expect(errors).toContain('maintenance.clusterHour must be between 0 and 23 (inclusive)');
    });

    it('rejects clusterHour = 24', () => {
      const errors = validateExternalConfig({ maintenance: { clusterHour: 24 } });
      expect(errors).toContain('maintenance.clusterHour must be between 0 and 23 (inclusive)');
    });

    it('accepts clusterHour = 0', () => {
      expect(validateExternalConfig({ maintenance: { clusterHour: 0 } })).toEqual([]);
    });

    it('accepts clusterHour = 12', () => {
      expect(validateExternalConfig({ maintenance: { clusterHour: 12 } })).toEqual([]);
    });

    it('accepts clusterHour = 23', () => {
      expect(validateExternalConfig({ maintenance: { clusterHour: 23 } })).toEqual([]);
    });

    it('rejects halfLifeHours = 0', () => {
      const errors = validateExternalConfig({ recency: { halfLifeHours: 0 } });
      expect(errors).toContain('recency.halfLifeHours must be greater than 0');
    });

    it('rejects halfLifeHours = -1', () => {
      const errors = validateExternalConfig({ recency: { halfLifeHours: -1 } });
      expect(errors).toContain('recency.halfLifeHours must be greater than 0');
    });

    it('accepts halfLifeHours = 48', () => {
      expect(validateExternalConfig({ recency: { halfLifeHours: 48 } })).toEqual([]);
    });

    it('rejects decayFactor = -0.1', () => {
      const errors = validateExternalConfig({ recency: { decayFactor: -0.1 } });
      expect(errors).toContain('recency.decayFactor must be >= 0');
    });

    it('accepts decayFactor = 0', () => {
      expect(validateExternalConfig({ recency: { decayFactor: 0 } })).toEqual([]);
    });

    it('accepts decayFactor = 0.95', () => {
      expect(validateExternalConfig({ recency: { decayFactor: 0.95 } })).toEqual([]);
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

  describe('deep merge behavior', () => {
    it('CLI override of one nested field preserves other fields in same section', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          retrieval: { mmrLambda: 0.9 },
        },
      });

      // The overridden field
      expect(config.retrieval.mmrLambda).toBe(0.9);
      // Other fields in the same section preserved from defaults
      expect(config.retrieval.feedbackWeight).toBe(0.1);
      expect(config.retrieval.primary).toBe('hybrid');
      expect(config.retrieval.vectorEnrichment).toBe(false);
    });

    it('env var override of one nested field preserves other fields in same section', () => {
      process.env.CAUSANTIC_RECENCY_DECAY_FACTOR = '0.8';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.recency.decayFactor).toBe(0.8);
      expect(config.recency.halfLifeHours).toBe(48); // Default preserved
    });

    it('multiple layers of overrides merge correctly', () => {
      // Env sets one field, CLI sets another in the same section
      process.env.CAUSANTIC_RETRIEVAL_MMR_LAMBDA = '0.3';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          retrieval: { primary: 'vector' },
        },
      });

      // CLI override wins for primary
      expect(config.retrieval.primary).toBe('vector');
      // deepMerge spreads both target and source, so env-set mmrLambda survives
      // because CLI only sets { primary: 'vector' } without mmrLambda
      expect(config.retrieval.mmrLambda).toBe(0.3);
      // Default preserved for fields neither env nor CLI touched
      expect(config.retrieval.feedbackWeight).toBe(0.1);
      expect(config.retrieval.vectorEnrichment).toBe(false);
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

  it('reports vectors.maxCount negative', () => {
    const errors = validateExternalConfig({
      vectors: { maxCount: -1 },
    });
    expect(errors).toContain('vectors.maxCount must be >= 0 (0 = unlimited)');
  });

  it('accepts vectors.maxCount of 0 (unlimited)', () => {
    const errors = validateExternalConfig({
      vectors: { maxCount: 0 },
    });
    expect(errors).toEqual([]);
  });

  it('reports invalid embedding model', () => {
    const errors = validateExternalConfig({
      embedding: { model: 'nonexistent-model' },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("embedding.model 'nonexistent-model' is not a registered model");
  });

  it('accepts valid embedding model', () => {
    const errors = validateExternalConfig({
      embedding: { model: 'jina-small' },
    });
    expect(errors).toEqual([]);
  });

  it('reports lengthPenalty.referenceTokens <= 0', () => {
    const errors = validateExternalConfig({
      lengthPenalty: { referenceTokens: 0 },
    });
    expect(errors).toContain('lengthPenalty.referenceTokens must be greater than 0');
  });

  it('reports negative lengthPenalty.referenceTokens', () => {
    const errors = validateExternalConfig({
      lengthPenalty: { referenceTokens: -100 },
    });
    expect(errors).toContain('lengthPenalty.referenceTokens must be greater than 0');
  });

  it('accepts valid lengthPenalty.referenceTokens', () => {
    const errors = validateExternalConfig({
      lengthPenalty: { referenceTokens: 500 },
    });
    expect(errors).toEqual([]);
  });

  it('reports invalid retrieval.primary value', () => {
    const errors = validateExternalConfig({
      retrieval: { primary: 'invalid' as 'keyword' },
    });
    expect(errors).toContain("retrieval.primary must be 'keyword', 'vector', or 'hybrid'");
  });

  it('accepts all valid retrieval.primary values', () => {
    expect(validateExternalConfig({ retrieval: { primary: 'keyword' } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { primary: 'vector' } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { primary: 'hybrid' } })).toEqual([]);
  });

  it('reports retrieval.feedbackWeight out of range (too low)', () => {
    const errors = validateExternalConfig({
      retrieval: { feedbackWeight: -0.1 },
    });
    expect(errors).toContain('retrieval.feedbackWeight must be between 0 and 1 (inclusive)');
  });

  it('reports retrieval.feedbackWeight out of range (too high)', () => {
    const errors = validateExternalConfig({
      retrieval: { feedbackWeight: 1.1 },
    });
    expect(errors).toContain('retrieval.feedbackWeight must be between 0 and 1 (inclusive)');
  });

  it('accepts valid retrieval.feedbackWeight boundary values', () => {
    expect(validateExternalConfig({ retrieval: { feedbackWeight: 0 } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { feedbackWeight: 1 } })).toEqual([]);
    expect(validateExternalConfig({ retrieval: { feedbackWeight: 0.5 } })).toEqual([]);
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

  it('defaults retrievalPrimary to hybrid', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.retrievalPrimary).toBe('hybrid');
  });

  it('maps incrementalClusterThreshold from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        clustering: { incrementalThreshold: 0.5 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.incrementalClusterThreshold).toBe(0.5);
  });

  it('maps feedbackWeight from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        retrieval: { feedbackWeight: 0.25 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.feedbackWeight).toBe(0.25);
  });

  it('maps recency settings from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        recency: { decayFactor: 0.5, halfLifeHours: 24 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.recency.decayFactor).toBe(0.5);
    expect(runtime.recency.halfLifeHours).toBe(24);
  });

  it('maps lengthPenalty settings from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        lengthPenalty: { enabled: false, referenceTokens: 1000 },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.lengthPenalty.enabled).toBe(false);
    expect(runtime.lengthPenalty.referenceTokens).toBe(1000);
  });

  it('maps semanticIndex settings from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        semanticIndex: {
          enabled: true,
          targetDescriptionTokens: 200,
          batchRefreshLimit: 100,
          useForSearch: false,
        },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.semanticIndex.enabled).toBe(true);
    expect(runtime.semanticIndex.targetDescriptionTokens).toBe(200);
    expect(runtime.semanticIndex.batchRefreshLimit).toBe(100);
    expect(runtime.semanticIndex.useForSearch).toBe(false);
  });

  it('maps embeddingModel and embeddingEager from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        embedding: { model: 'jina-code', eager: true },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.embeddingModel).toBe('jina-code');
    expect(runtime.embeddingEager).toBe(true);
  });

  it('maps retrievalPrimary and vectorEnrichment from external config', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
      cliOverrides: {
        retrieval: { primary: 'keyword', vectorEnrichment: true },
      },
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.retrievalPrimary).toBe('keyword');
    expect(runtime.vectorEnrichment).toBe(true);
  });

  it('preserves repomap from DEFAULT_CONFIG (no external mapping)', () => {
    const external = loadConfig({
      skipEnv: true,
      skipProjectConfig: true,
      skipUserConfig: true,
    });

    const runtime = toRuntimeConfig(external);

    expect(runtime.repomap).toEqual(DEFAULT_CONFIG.repomap);
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
