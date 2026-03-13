/**
 * Tests for initRuntimeConfig / getConfig cache lifecycle and deep-merge overrides.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConfig,
  initRuntimeConfig,
  resetRuntimeConfig,
  DEFAULT_CONFIG,
  type MemoryConfig,
} from '../../src/config/memory-config.js';

describe('initRuntimeConfig / getConfig cache', () => {
  beforeEach(() => {
    resetRuntimeConfig();
  });

  it('getConfig() returns defaults when no runtime config set', () => {
    const config = getConfig();
    expect(config).toBe(DEFAULT_CONFIG);
  });

  it('initRuntimeConfig() sets the cached config', () => {
    const custom: MemoryConfig = {
      ...DEFAULT_CONFIG,
      maxChainDepth: 99,
    };
    initRuntimeConfig(custom);

    const config = getConfig();
    expect(config.maxChainDepth).toBe(99);
  });

  it('getConfig() returns cached config after init', () => {
    const custom: MemoryConfig = {
      ...DEFAULT_CONFIG,
      clusterThreshold: 0.25,
    };
    initRuntimeConfig(custom);

    expect(getConfig()).toBe(custom);
  });

  it('getConfig(overrides) deep-merges nested objects correctly', () => {
    initRuntimeConfig({
      ...DEFAULT_CONFIG,
      hybridSearch: { ...DEFAULT_CONFIG.hybridSearch, rrfK: 100 },
    });

    // Only override vectorWeight — rrfK should come from the cached base
    const config = getConfig({
      hybridSearch: { vectorWeight: 2.0 } as MemoryConfig['hybridSearch'],
    });

    // Override applied
    expect(config.hybridSearch.vectorWeight).toBe(2.0);
    // Base value preserved via deep merge
    expect(config.hybridSearch.rrfK).toBe(100);
  });

  it('deep-merges clusterExpansion overrides', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({
      clusterExpansion: { ...DEFAULT_CONFIG.clusterExpansion, maxClusters: 10 },
    });

    expect(config.clusterExpansion.maxClusters).toBe(10);
    expect(config.clusterExpansion.maxSiblings).toBe(DEFAULT_CONFIG.clusterExpansion.maxSiblings);
  });

  it('deep-merges mmrReranking overrides', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({ mmrReranking: { lambda: 0.3 } });
    expect(config.mmrReranking.lambda).toBe(0.3);
  });

  it('deep-merges recency overrides', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({ recency: { ...DEFAULT_CONFIG.recency, halfLifeHours: 12 } });

    expect(config.recency.halfLifeHours).toBe(12);
    expect(config.recency.decayFactor).toBe(DEFAULT_CONFIG.recency.decayFactor);
  });

  it('deep-merges lengthPenalty overrides', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({
      lengthPenalty: { ...DEFAULT_CONFIG.lengthPenalty, referenceTokens: 1000 },
    });

    expect(config.lengthPenalty.referenceTokens).toBe(1000);
    expect(config.lengthPenalty.enabled).toBe(DEFAULT_CONFIG.lengthPenalty.enabled);
  });

  it('deep-merges repomap overrides (preserves languages array)', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({ repomap: { ...DEFAULT_CONFIG.repomap, maxTokens: 2048 } });

    expect(config.repomap.maxTokens).toBe(2048);
    expect(config.repomap.languages).toEqual(DEFAULT_CONFIG.repomap.languages);
  });

  it('deep-merges semanticIndex overrides', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({
      semanticIndex: { ...DEFAULT_CONFIG.semanticIndex, batchRefreshLimit: 100 },
    });

    expect(config.semanticIndex.batchRefreshLimit).toBe(100);
    expect(config.semanticIndex.enabled).toBe(DEFAULT_CONFIG.semanticIndex.enabled);
  });

  it('overrides do not mutate the cached config', () => {
    const custom: MemoryConfig = {
      ...DEFAULT_CONFIG,
      maxChainDepth: 42,
      hybridSearch: { ...DEFAULT_CONFIG.hybridSearch },
    };
    initRuntimeConfig(custom);

    // Apply override
    getConfig({ maxChainDepth: 999 });

    // Cached config unchanged
    expect(getConfig().maxChainDepth).toBe(42);
  });

  it('idempotent: calling initRuntimeConfig() twice uses the latest', () => {
    initRuntimeConfig({ ...DEFAULT_CONFIG, maxChainDepth: 10 });
    initRuntimeConfig({ ...DEFAULT_CONFIG, maxChainDepth: 20 });

    expect(getConfig().maxChainDepth).toBe(20);
  });

  it('getConfig() with empty overrides returns base without copying', () => {
    initRuntimeConfig(DEFAULT_CONFIG);

    const config = getConfig({});
    expect(config).toBe(DEFAULT_CONFIG);
  });
});
