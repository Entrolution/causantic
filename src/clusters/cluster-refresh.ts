/**
 * LLM-based cluster description refresh.
 * Uses Claude API to generate human-readable descriptions for clusters.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/memory-config.js';
import { getClusterById, upsertCluster, getStaleClusters } from '../storage/cluster-store.js';
import { getChunksByIds } from '../storage/chunk-store.js';
import type { StoredCluster, StoredChunk } from '../storage/types.js';
import { createLogger } from '../utils/logger.js';
import { createSecretStore } from '../utils/secret-store.js';

const log = createLogger('cluster-refresh');

/**
 * Result of cluster refresh.
 */
export interface RefreshResult {
  clusterId: string;
  name: string;
  description: string;
  durationMs: number;
}

/**
 * Options for cluster refresh.
 */
export interface RefreshOptions {
  /** Model to use. Default: from config. */
  model?: string;
  /** Max exemplar chunks to include in prompt. Default: 3. */
  maxExemplars?: number;
  /** Max tokens per chunk in prompt. Default: 500. */
  maxTokensPerChunk?: number;
}

/**
 * Rate limiter for API calls.
 */
class RateLimiter {
  private lastCall = 0;
  private minIntervalMs: number;

  constructor(callsPerMinute: number) {
    this.minIntervalMs = (60 * 1000) / callsPerMinute;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
}

/**
 * Cluster refresher for generating descriptions using Claude.
 */
export class ClusterRefresher {
  private client: Anthropic | null = null;
  private rateLimiter: RateLimiter;
  private config = getConfig();

  constructor() {
    this.rateLimiter = new RateLimiter(this.config.refreshRateLimitPerMin);
  }

  /**
   * Initialize the Anthropic client.
   * Checks keychain for API key if not set in environment.
   */
  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      // Check if API key is in environment
      if (!process.env.ANTHROPIC_API_KEY) {
        // Try to load from keychain
        const store = createSecretStore();
        const storedKey = await store.get('anthropic-api-key');
        if (storedKey) {
          process.env.ANTHROPIC_API_KEY = storedKey;
        }
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          'No Anthropic API key found. Set ANTHROPIC_API_KEY environment variable ' +
          'or run "causantic config set-key anthropic-api-key" to store in keychain.'
        );
      }

      this.client = new Anthropic();
    }
    return this.client;
  }

  /**
   * Refresh a single cluster's description.
   */
  async refreshCluster(
    clusterId: string,
    options: RefreshOptions = {}
  ): Promise<RefreshResult> {
    const startTime = Date.now();
    const { model = this.config.clusterRefreshModel, maxExemplars = 3, maxTokensPerChunk = 500 } =
      options;

    const cluster = getClusterById(clusterId);
    if (!cluster) {
      throw new Error(`Cluster not found: ${clusterId}`);
    }

    // Get exemplar chunks
    const exemplarIds = cluster.exemplarIds.slice(0, maxExemplars);
    const exemplars = getChunksByIds(exemplarIds);

    if (exemplars.length === 0) {
      return {
        clusterId,
        name: cluster.name ?? 'Empty Cluster',
        description: 'No exemplar chunks available.',
        durationMs: Date.now() - startTime,
      };
    }

    // Build prompt
    const prompt = buildRefreshPrompt(exemplars, maxTokensPerChunk);

    // Rate limit
    await this.rateLimiter.wait();

    // Call Claude API
    const client = await this.getClient();
    const response = await client.messages.create({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    // Parse response
    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const { name, description } = parseRefreshResponse(text);

    // Update cluster
    upsertCluster({
      id: clusterId,
      name,
      description,
    });

    return {
      clusterId,
      name,
      description,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Refresh all stale clusters.
   */
  async refreshStaleClusters(
    options: RefreshOptions & { maxAgeMs?: number } = {}
  ): Promise<RefreshResult[]> {
    const { maxAgeMs = 24 * 60 * 60 * 1000 } = options; // Default: 24 hours

    const staleClusters = getStaleClusters(maxAgeMs);
    const results: RefreshResult[] = [];

    for (const cluster of staleClusters) {
      try {
        const result = await this.refreshCluster(cluster.id, options);
        results.push(result);
      } catch (error) {
        log.error(`Failed to refresh cluster ${cluster.id}`, { error: (error as Error).message });
      }
    }

    return results;
  }

  /**
   * Refresh all clusters (force refresh).
   */
  async refreshAllClusters(options: RefreshOptions = {}): Promise<RefreshResult[]> {
    const staleClusters = getStaleClusters(0); // Get all
    const results: RefreshResult[] = [];

    for (const cluster of staleClusters) {
      try {
        const result = await this.refreshCluster(cluster.id, options);
        results.push(result);
      } catch (error) {
        log.error(`Failed to refresh cluster ${cluster.id}`, { error: (error as Error).message });
      }
    }

    return results;
  }
}

/**
 * Build prompt for cluster description generation.
 */
function buildRefreshPrompt(exemplars: StoredChunk[], maxTokensPerChunk: number): string {
  const truncatedExemplars = exemplars.map((e) => {
    const content = e.content;
    // Rough token estimate: 4 chars per token
    const maxChars = maxTokensPerChunk * 4;
    if (content.length > maxChars) {
      return content.slice(0, maxChars) + '\n...[truncated]';
    }
    return content;
  });

  return `Analyze these conversation excerpts from the same topic cluster and generate:
1. A short name (2-5 words) that captures the main theme
2. A brief description (1-2 sentences) of what this cluster is about

Excerpts:
${truncatedExemplars.map((e, i) => `--- Excerpt ${i + 1} ---\n${e}`).join('\n\n')}

Respond in this exact format:
Name: [short name]
Description: [brief description]`;
}

/**
 * Parse the LLM response to extract name and description.
 */
function parseRefreshResponse(text: string): { name: string; description: string } {
  const nameMatch = text.match(/Name:\s*(.+?)(?:\n|$)/i);
  const descMatch = text.match(/Description:\s*(.+?)(?:\n\n|$)/is);

  return {
    name: nameMatch?.[1]?.trim() ?? 'Unnamed Cluster',
    description: descMatch?.[1]?.trim() ?? text.trim(),
  };
}

// Singleton instance
export const clusterRefresher = new ClusterRefresher();
