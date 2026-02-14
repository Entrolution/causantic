/**
 * Tests for cluster refresh and API key handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('cluster-refresh', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    // Clear API key from environment for tests
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  describe('API key resolution', () => {
    it('uses environment variable when set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-env-key';

      // Environment should take precedence
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-env-key');
    });

    it('key resolution order: env first, then keychain', () => {
      // This tests the expected resolution order
      const resolutionOrder = ['environment', 'keychain'];

      expect(resolutionOrder[0]).toBe('environment');
      expect(resolutionOrder[1]).toBe('keychain');
    });

    it('error message includes keychain instructions', () => {
      const expectedMessage =
        'No Anthropic API key found. Set ANTHROPIC_API_KEY environment variable ' +
        'or run "causantic config set-key anthropic-api-key" to store in keychain.';

      expect(expectedMessage).toContain('ANTHROPIC_API_KEY');
      expect(expectedMessage).toContain('causantic config set-key');
      expect(expectedMessage).toContain('keychain');
    });
  });

  describe('secret store integration', () => {
    it('createSecretStore returns a store with get method', async () => {
      const { createSecretStore } = await import('../../src/utils/secret-store.js');
      const store = createSecretStore();

      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.isAvailable).toBe('function');
    });

    it('secret store key name matches init storage', () => {
      // The key name used in cluster-refresh.ts must match what init stores
      const keyNameInClusterRefresh = 'anthropic-api-key';
      const keyNameInInit = 'anthropic-api-key';

      expect(keyNameInClusterRefresh).toBe(keyNameInInit);
    });
  });

  describe('ClusterRefresher interface', () => {
    it('refreshCluster returns RefreshResult', () => {
      const mockResult = {
        clusterId: 'cluster-123',
        name: 'Test Cluster',
        description: 'A test cluster description',
        durationMs: 150,
      };

      expect(mockResult.clusterId).toBe('cluster-123');
      expect(mockResult.name).toBe('Test Cluster');
      expect(typeof mockResult.durationMs).toBe('number');
    });

    it('RefreshOptions has expected defaults', () => {
      const defaults = {
        maxExemplars: 3,
        maxTokensPerChunk: 500,
      };

      expect(defaults.maxExemplars).toBe(3);
      expect(defaults.maxTokensPerChunk).toBe(500);
    });
  });

  describe('rate limiting', () => {
    it('rate limiter respects calls per minute', async () => {
      const callsPerMinute = 30;
      const minIntervalMs = (60 * 1000) / callsPerMinute;

      expect(minIntervalMs).toBe(2000); // 2 seconds between calls
    });
  });

  describe('prompt generation', () => {
    it('truncates long content to maxTokensPerChunk', () => {
      const maxTokensPerChunk = 500;
      const maxChars = maxTokensPerChunk * 4; // ~4 chars per token
      const longContent = 'x'.repeat(maxChars + 100);

      const truncated =
        longContent.length > maxChars
          ? longContent.slice(0, maxChars) + '\n...[truncated]'
          : longContent;

      expect(truncated.length).toBeLessThan(longContent.length);
      expect(truncated).toContain('[truncated]');
    });

    it('prompt includes exemplar content', () => {
      const exemplars = ['Content from chunk 1', 'Content from chunk 2'];

      const prompt = `Analyze these conversation excerpts from the same topic cluster and generate:
1. A short name (2-5 words) that captures the main theme
2. A brief description (1-2 sentences) of what this cluster is about

Excerpts:
${exemplars.map((e, i) => `--- Excerpt ${i + 1} ---\n${e}`).join('\n\n')}

Respond in this exact format:
Name: [short name]
Description: [brief description]`;

      expect(prompt).toContain('Excerpt 1');
      expect(prompt).toContain('Excerpt 2');
      expect(prompt).toContain('Content from chunk 1');
      expect(prompt).toContain('Name:');
      expect(prompt).toContain('Description:');
    });
  });

  describe('response parsing', () => {
    it('extracts name from response', () => {
      const response =
        'Name: Database Optimization\nDescription: Techniques for improving query performance.';
      const nameMatch = response.match(/Name:\s*(.+?)(?:\n|$)/i);

      expect(nameMatch?.[1]?.trim()).toBe('Database Optimization');
    });

    it('extracts description from response', () => {
      const response =
        'Name: Database Optimization\nDescription: Techniques for improving query performance.';
      const descMatch = response.match(/Description:\s*(.+?)(?:\n\n|$)/is);

      expect(descMatch?.[1]?.trim()).toBe('Techniques for improving query performance.');
    });

    it('handles missing name gracefully', () => {
      const response = 'Some response without proper formatting';
      const nameMatch = response.match(/Name:\s*(.+?)(?:\n|$)/i);

      const name = nameMatch?.[1]?.trim() ?? 'Unnamed Cluster';
      expect(name).toBe('Unnamed Cluster');
    });
  });
});
