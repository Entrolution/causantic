/**
 * Tests for embedding model configuration (Item 14).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateExternalConfig, toRuntimeConfig } from '../../src/config/loader.js';
import { DEFAULT_CONFIG } from '../../src/config/memory-config.js';

describe('embedding model config', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CAUSANTIC_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
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
    it('defaults embedding.model to jina-small', () => {
      const config = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.model).toBe('jina-small');
    });

    it('DEFAULT_CONFIG has embeddingModel set to jina-small', () => {
      expect(DEFAULT_CONFIG.embeddingModel).toBe('jina-small');
    });
  });

  describe('env var override', () => {
    it('overrides embedding model from CAUSANTIC_EMBEDDING_MODEL', () => {
      process.env.CAUSANTIC_EMBEDDING_MODEL = 'nomic-v1.5';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      expect(config.embedding.model).toBe('nomic-v1.5');
    });
  });

  describe('CLI override', () => {
    it('CLI overrides take precedence over env vars', () => {
      process.env.CAUSANTIC_EMBEDDING_MODEL = 'nomic-v1.5';

      const config = loadConfig({
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          embedding: { model: 'bge-small' },
        },
      });

      expect(config.embedding.model).toBe('bge-small');
    });
  });

  describe('validation', () => {
    it('accepts valid model IDs', () => {
      expect(validateExternalConfig({ embedding: { model: 'jina-small' } })).toEqual([]);
      expect(validateExternalConfig({ embedding: { model: 'nomic-v1.5' } })).toEqual([]);
      expect(validateExternalConfig({ embedding: { model: 'jina-code' } })).toEqual([]);
      expect(validateExternalConfig({ embedding: { model: 'bge-small' } })).toEqual([]);
    });

    it('rejects unknown model ID', () => {
      const errors = validateExternalConfig({ embedding: { model: 'unknown-model' } });
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("'unknown-model'");
      expect(errors[0]).toContain('not a registered model');
    });
  });

  describe('toRuntimeConfig', () => {
    it('maps embedding.model to embeddingModel', () => {
      const external = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
        cliOverrides: {
          embedding: { model: 'nomic-v1.5' },
        },
      });

      const runtime = toRuntimeConfig(external);
      expect(runtime.embeddingModel).toBe('nomic-v1.5');
    });

    it('defaults embeddingModel to jina-small', () => {
      const external = loadConfig({
        skipEnv: true,
        skipProjectConfig: true,
        skipUserConfig: true,
      });

      const runtime = toRuntimeConfig(external);
      expect(runtime.embeddingModel).toBe('jina-small');
    });
  });
});
