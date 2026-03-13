/**
 * Tests for the shared bootstrap() function.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrap } from '../../src/config/bootstrap.js';
import { getConfig, resetRuntimeConfig, DEFAULT_CONFIG } from '../../src/config/memory-config.js';

describe('bootstrap', () => {
  beforeEach(() => {
    resetRuntimeConfig();
  });

  it('makes getConfig() return user config instead of bare defaults', () => {
    // Before bootstrap, getConfig returns DEFAULT_CONFIG
    expect(getConfig()).toBe(DEFAULT_CONFIG);

    bootstrap({ skipProjectConfig: true, skipUserConfig: true, skipEnv: true });

    // After bootstrap, getConfig returns a resolved config (not the DEFAULT_CONFIG reference)
    const config = getConfig();
    // Values match defaults but the object is different (runtime config was set)
    expect(config.clusterThreshold).toBe(DEFAULT_CONFIG.clusterThreshold);
    expect(config).not.toBe(DEFAULT_CONFIG);
  });

  it('idempotent: second call does not throw', () => {
    const opts = { skipProjectConfig: true, skipUserConfig: true, skipEnv: true };

    expect(() => {
      bootstrap(opts);
      bootstrap(opts);
    }).not.toThrow();
  });

  it('returns the resolved MemoryConfig', () => {
    const config = bootstrap({
      skipProjectConfig: true,
      skipUserConfig: true,
      skipEnv: true,
    });

    expect(config.clusterThreshold).toBe(DEFAULT_CONFIG.clusterThreshold);
    expect(config.maxChainDepth).toBe(DEFAULT_CONFIG.maxChainDepth);
    expect(config.hybridSearch).toBeDefined();
  });

  it('respects CLI overrides passed through options', () => {
    const config = bootstrap({
      skipProjectConfig: true,
      skipUserConfig: true,
      skipEnv: true,
      cliOverrides: {
        traversal: { maxDepth: 10 },
      },
    });

    expect(config.maxChainDepth).toBe(10);
    expect(getConfig().maxChainDepth).toBe(10);
  });
});
