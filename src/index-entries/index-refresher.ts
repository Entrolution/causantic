/**
 * Batch index entry refinement and backfill.
 *
 * Follows the cluster-refresh.ts pattern: Anthropic client, rate limiter,
 * keychain API key. Used by the backfill-index maintenance task.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/memory-config.js';
import { getChunksByIds } from '../storage/chunk-store.js';
import {
  getUnindexedChunkIds,
  insertIndexEntries,
  getIndexedChunkCount,
} from '../storage/index-entry-store.js';
import { getChunkCount } from '../storage/chunk-store.js';
import { indexVectorStore } from '../storage/vector-store.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { createSecretStore } from '../utils/secret-store.js';
import { createLogger } from '../utils/logger.js';
import { generateLLMEntries, generateHeuristicEntry } from './index-generator.js';
import type { ChunkForIndexing } from './index-generator.js';

const log = createLogger('index-refresher');

/** Rate limiter for API calls. */
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

/** Result from a backfill run. */
export interface BackfillResult {
  /** Number of new index entries created */
  entriesCreated: number;
  /** Number of entries created via LLM */
  llmEntries: number;
  /** Number of entries created via Jeopardy-style generation */
  jeopardyEntries: number;
  /** Number of entries created via heuristic */
  heuristicEntries: number;
  /** Number of chunks that had no content to index */
  skipped: number;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Index entry refresher for batch backfill and refinement.
 */
export class IndexRefresher {
  private client: Anthropic | null = null;
  private rateLimiter: RateLimiter;
  private config = getConfig();

  constructor() {
    this.rateLimiter = new RateLimiter(this.config.refreshRateLimitPerMin);
  }

  /**
   * Initialize the Anthropic client. Returns null if no API key available.
   */
  private async getClient(): Promise<Anthropic | null> {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        try {
          const store = createSecretStore();
          const storedKey = await store.get('anthropic-api-key');
          if (storedKey) {
            process.env.ANTHROPIC_API_KEY = storedKey;
          }
        } catch {
          // Keychain not available
        }
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return null;
      }

      this.client = new Anthropic();
    }
    return this.client;
  }

  /**
   * Backfill index entries for chunks that don't have them.
   *
   * Processes chunks in session-grouped batches. Uses LLM when available,
   * falls back to heuristic. Also embeds the generated descriptions.
   */
  async backfill(options?: {
    limit?: number;
    onProgress?: (current: number, total: number) => void;
  }): Promise<BackfillResult> {
    const startTime = Date.now();
    const limit = options?.limit ?? this.config.semanticIndex.batchRefreshLimit;

    // Find chunks without index entries
    const unindexedChunkIds = getUnindexedChunkIds(limit);

    if (unindexedChunkIds.length === 0) {
      return {
        entriesCreated: 0,
        llmEntries: 0,
        jeopardyEntries: 0,
        heuristicEntries: 0,
        skipped: 0,
        durationMs: Date.now() - startTime,
      };
    }

    log.info('Starting index backfill', { chunkCount: unindexedChunkIds.length });

    // Load chunks
    const chunks = getChunksByIds(unindexedChunkIds);

    // Group by session slug for batched LLM calls
    const sessionGroups = new Map<string, ChunkForIndexing[]>();
    for (const chunk of chunks) {
      const group = sessionGroups.get(chunk.sessionSlug) ?? [];
      group.push({
        id: chunk.id,
        sessionSlug: chunk.sessionSlug,
        startTime: chunk.startTime,
        content: chunk.content,
        approxTokens: chunk.approxTokens,
        agentId: chunk.agentId,
        teamName: chunk.teamName,
      });
      sessionGroups.set(chunk.sessionSlug, group);
    }

    let entriesCreated = 0;
    let llmEntries = 0;
    let jeopardyEntries = 0;
    let heuristicEntries = 0;
    let skipped = 0;

    // Set up embedder
    const embedder = new Embedder();
    const embeddingModel = this.config.embeddingModel;
    await embedder.load(getModel(embeddingModel));
    indexVectorStore.setModelId(embeddingModel);

    try {
      const client = await this.getClient();
      let sessionIndex = 0;
      const totalSessions = sessionGroups.size;

      for (const [sessionSlug, sessionChunks] of sessionGroups) {
        sessionIndex++;
        options?.onProgress?.(sessionIndex, totalSessions);

        // Generate entries (rate limiting happens per sub-batch inside generateLLMEntries)
        let entries;
        if (client) {
          entries = await generateLLMEntries(sessionChunks, sessionSlug, {
            onBeforeBatch: () => this.rateLimiter.wait(),
          });
        } else {
          entries = sessionChunks.map((chunk) => generateHeuristicEntry(chunk, sessionSlug));
        }

        // Filter out empty descriptions
        const validEntries = entries.filter((e) => e.description.trim().length > 0);
        skipped += entries.length - validEntries.length;

        if (validEntries.length === 0) continue;

        // Insert entries
        const entryIds = insertIndexEntries(validEntries);

        // Embed descriptions
        const embeddings: Array<{ id: string; embedding: number[] }> = [];
        for (let i = 0; i < validEntries.length; i++) {
          const result = await embedder.embed(validEntries[i].description, false);
          embeddings.push({ id: entryIds[i], embedding: result.embedding });
        }

        await indexVectorStore.insertBatch(embeddings);

        // Track stats
        for (const entry of validEntries) {
          if (entry.generationMethod === 'jeopardy') {
            jeopardyEntries++;
          } else if (entry.generationMethod === 'llm') {
            llmEntries++;
          } else {
            heuristicEntries++;
          }
        }
        entriesCreated += validEntries.length;

        log.debug('Backfilled session', {
          sessionSlug,
          entries: validEntries.length,
        });
      }
    } finally {
      await embedder.dispose();
    }

    log.info('Index backfill complete', {
      entriesCreated,
      llmEntries,
      jeopardyEntries,
      heuristicEntries,
      skipped,
      durationMs: Date.now() - startTime,
    });

    return {
      entriesCreated,
      llmEntries,
      jeopardyEntries,
      heuristicEntries,
      skipped,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get backfill status: how many chunks still need index entries.
   */
  getBackfillStatus(): { indexed: number; total: number; remaining: number } {
    const indexed = getIndexedChunkCount();
    const total = getChunkCount();

    return {
      indexed,
      total,
      remaining: total - indexed,
    };
  }
}

// Singleton
export const indexRefresher = new IndexRefresher();
