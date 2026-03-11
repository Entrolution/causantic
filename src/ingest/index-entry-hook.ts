/**
 * Hook for generating semantic index entries during ingestion.
 *
 * Called after chunks are stored and embedded. Generates index entries
 * (LLM or heuristic) and embeds the descriptions into the index vector store.
 */

import { getConfig } from '../config/memory-config.js';
import { insertIndexEntries } from '../storage/index-entry-store.js';
import { indexVectorStore } from '../storage/vector-store.js';
import { Embedder } from '../models/embedder.js';
import { getModel } from '../models/model-registry.js';
import { generateLLMEntries, generateHeuristicEntry } from '../index-entries/index-generator.js';
import type { ChunkForIndexing } from '../index-entries/index-generator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('index-entry-hook');

/** Shared embedder for index entry descriptions. */
let sharedIndexEmbedder: Embedder | null = null;
let sharedIndexEmbedderModelId: string | null = null;

async function getIndexEmbedder(modelId: string): Promise<Embedder> {
  if (!sharedIndexEmbedder || sharedIndexEmbedderModelId !== modelId) {
    if (sharedIndexEmbedder) {
      await sharedIndexEmbedder.dispose();
    }
    sharedIndexEmbedder = new Embedder();
    await sharedIndexEmbedder.load(getModel(modelId));
    sharedIndexEmbedderModelId = modelId;
  }
  return sharedIndexEmbedder;
}

/**
 * Generate and store index entries for newly ingested chunks.
 *
 * This is called from processMainSession() after chunks are stored and embedded.
 * It's a best-effort operation — failures are logged but don't block ingestion.
 */
export async function generateIndexEntriesForChunks(
  chunks: ChunkForIndexing[],
  sessionSlug: string,
  _chunkEmbeddings: number[][],
  _chunkIds: string[],
  embeddingModel: string,
): Promise<void> {
  const config = getConfig();

  if (!config.semanticIndex.enabled) return;
  if (chunks.length === 0) return;

  try {
    // Generate descriptions (LLM primary, heuristic fallback)
    let entries;
    try {
      entries = await generateLLMEntries(chunks, sessionSlug);
    } catch {
      log.debug('LLM generation unavailable, using heuristic');
      entries = chunks.map((chunk) => generateHeuristicEntry(chunk, sessionSlug));
    }

    // Filter out empty descriptions
    const validEntries = entries.filter((e) => e.description.trim().length > 0);
    if (validEntries.length === 0) return;

    // Insert entries into database
    const entryIds = insertIndexEntries(validEntries);

    // Embed descriptions into index vector store
    indexVectorStore.setModelId(embeddingModel);
    const embedder = await getIndexEmbedder(embeddingModel);

    const embeddings: Array<{ id: string; embedding: number[] }> = [];
    for (let i = 0; i < validEntries.length; i++) {
      const result = await embedder.embed(validEntries[i].description, false);
      embeddings.push({ id: entryIds[i], embedding: result.embedding });
    }

    await indexVectorStore.insertBatch(embeddings);

    const methodCounts: Record<string, number> = {};
    for (const e of validEntries) {
      methodCounts[e.generationMethod] = (methodCounts[e.generationMethod] ?? 0) + 1;
    }
    log.debug('Generated index entries', {
      sessionSlug,
      count: validEntries.length,
      ...methodCounts,
    });
  } catch (error) {
    // Non-fatal: index generation failure should not block ingestion
    log.warn('Failed to generate index entries', {
      sessionSlug,
      error: (error as Error).message,
    });
  }
}
