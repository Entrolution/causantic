/**
 * Index entry generation: hybrid jeopardy + summary, heuristic fallback.
 *
 * For each chunk, generates:
 * - 3-5 Jeopardy-style search target queries (embed close to user queries)
 * - 1 summary description (embed close to chunk content, safety net for recall)
 *
 * LLM generation batches chunks into Haiku calls. Each query/summary becomes
 * a separate index entry. Heuristic fallback extracts the first meaningful
 * lines when offline.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/memory-config.js';
import { approximateTokens } from '../utils/token-counter.js';
import { createSecretStore } from '../utils/secret-store.js';
import { createLogger } from '../utils/logger.js';
import type { IndexEntryInput } from '../storage/types.js';

const log = createLogger('index-generator');

/** Chunk data needed for index entry generation. */
export interface ChunkForIndexing {
  id: string;
  sessionSlug: string;
  startTime: string;
  content: string;
  approxTokens: number;
  agentId?: string | null;
  teamName?: string | null;
}

/** Options for LLM generation. */
export interface GenerateOptions {
  /** Override model. Default: from config (clusterRefreshModel). */
  model?: string;
  /** Max tokens per chunk sent to LLM. Default: 500. */
  maxChunkTokens?: number;
  /** Target description length (unused for jeopardy, kept for API compat). */
  targetDescriptionTokens?: number;
  /** Called before each sub-batch API call for rate limiting. */
  onBeforeBatch?: () => Promise<void>;
}

/** Parsed output for a single chunk from the LLM response. */
export interface ParsedChunkEntries {
  /** Summary description (~20-30 words), null if missing. */
  summary: string | null;
  /** Jeopardy-style search queries (3-5 per chunk). */
  queries: string[];
}

/**
 * Maximum chunks per LLM batch. With 3-5 queries + 1 summary per chunk
 * (~400 tokens output each), 8 chunks fits within Haiku's 4096 output cap.
 */
const MAX_CHUNKS_PER_BATCH = 8;

/**
 * Generate index entries for a batch of chunks using LLM.
 *
 * Produces 3-5 Jeopardy-style queries + 1 summary per chunk.
 * Each query becomes a 'jeopardy' entry, the summary becomes an 'llm' entry.
 * Falls back to heuristic if the API call fails.
 */
export async function generateLLMEntries(
  chunks: ChunkForIndexing[],
  sessionSlug: string,
  options?: GenerateOptions,
): Promise<IndexEntryInput[]> {
  if (chunks.length === 0) return [];

  const config = getConfig();
  const model = options?.model ?? config.clusterRefreshModel;
  const maxChunkTokens = options?.maxChunkTokens ?? 500;

  // Get Anthropic client
  const client = await getAnthropicClient();
  if (!client) {
    log.info('No API key available, falling back to heuristic generation');
    return chunks.map((chunk) => generateHeuristicEntry(chunk, sessionSlug));
  }

  // Split into sub-batches that fit within Haiku's output limits
  const allResults: IndexEntryInput[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_CHUNKS_PER_BATCH) {
    const batchChunks = chunks.slice(batchStart, batchStart + MAX_CHUNKS_PER_BATCH);

    // Rate limit before each sub-batch API call
    if (options?.onBeforeBatch) {
      await options.onBeforeBatch();
    }

    // Truncate chunk content for prompt
    const truncatedChunks = batchChunks.map((chunk, i) => {
      const maxChars = maxChunkTokens * 4;
      const content =
        chunk.content.length > maxChars
          ? chunk.content.slice(0, maxChars) + '\n...[truncated]'
          : chunk.content;
      return { index: i, content, id: chunk.id };
    });

    const prompt = buildGenerationPrompt(truncatedChunks);

    try {
      const response = await callWithRetry(client, model, prompt, batchChunks.length);

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const entriesByChunk = parseGenerationResponse(text, batchChunks.length);

      for (let i = 0; i < batchChunks.length; i++) {
        const chunk = batchChunks[i];
        const parsed = entriesByChunk.get(i);

        if (parsed && (parsed.queries.length > 0 || parsed.summary)) {
          // Create one entry per jeopardy query
          for (const query of parsed.queries) {
            allResults.push({
              chunkIds: [chunk.id],
              sessionSlug,
              startTime: chunk.startTime,
              description: query,
              approxTokens: approximateTokens(query),
              agentId: chunk.agentId,
              teamName: chunk.teamName,
              generationMethod: 'jeopardy',
            });
          }

          // Create one entry for the summary
          if (parsed.summary) {
            allResults.push({
              chunkIds: [chunk.id],
              sessionSlug,
              startTime: chunk.startTime,
              description: parsed.summary,
              approxTokens: approximateTokens(parsed.summary),
              agentId: chunk.agentId,
              teamName: chunk.teamName,
              generationMethod: 'llm',
            });
          }
        } else {
          // SKIP or missing — fall back to heuristic
          allResults.push(generateHeuristicEntry(chunk, sessionSlug));
        }
      }
    } catch (error) {
      log.warn('LLM batch failed, falling back to heuristic for batch', {
        error: (error as Error).message,
        batchStart,
        batchSize: batchChunks.length,
      });
      for (const chunk of batchChunks) {
        allResults.push(generateHeuristicEntry(chunk, sessionSlug));
      }
    }
  }

  return allResults;
}

/**
 * Generate a heuristic index entry for a single chunk.
 *
 * Extracts the first meaningful content lines, trimmed to ~130 tokens.
 * Used as offline fallback or when LLM is unavailable.
 */
export function generateHeuristicEntry(
  chunk: ChunkForIndexing,
  sessionSlug: string,
): IndexEntryInput {
  const description = generateHeuristicDescription(chunk.content);

  return {
    chunkIds: [chunk.id],
    sessionSlug,
    startTime: chunk.startTime,
    description,
    approxTokens: approximateTokens(description),
    agentId: chunk.agentId,
    teamName: chunk.teamName,
    generationMethod: 'heuristic',
  };
}

/**
 * Generate a heuristic description from chunk content.
 * Takes the first meaningful lines up to ~130 tokens.
 */
function generateHeuristicDescription(content: string): string {
  const lines = content.split('\n');
  const meaningful: string[] = [];
  let tokenCount = 0;
  const targetTokens = 130;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and pure separators
    if (!trimmed || /^[-=_*]{3,}$/.test(trimmed)) continue;
    // Skip tool use blocks and code fence markers
    if (trimmed.startsWith('```') || trimmed.startsWith('Tool:')) continue;

    const lineTokens = approximateTokens(trimmed);
    if (tokenCount + lineTokens > targetTokens && meaningful.length > 0) break;

    meaningful.push(trimmed);
    tokenCount += lineTokens;
  }

  return meaningful.join(' ').slice(0, targetTokens * 5); // ~5 chars/token safety cap
}

/**
 * Build the LLM prompt for hybrid jeopardy + summary generation.
 */
export function buildGenerationPrompt(
  chunks: Array<{ index: number; content: string; id: string }>,
): string {
  const chunkTexts = chunks.map((c) => `--- Chunk ${c.index} ---\n${c.content}`).join('\n\n');

  return `You are building a search index for a memory system used by AI agents (Claude Opus, Sonnet) and human developers. For each conversation chunk below, produce:

1. **3-5 search queries** — Jeopardy-style: the chunk is the "answer", what are the "questions" a user would type to find it?
2. **1 summary** — a concise description of what the chunk covers (~20-30 words)

Rules for queries:
- Each query should be a natural question or search phrase (5-20 words)
- Queries must be SPECIFIC enough to uniquely target THIS chunk, not the general topic
- Focus on the concrete outcome, decision, error, or technique — not the topic category
- Include specific names: file paths, function names, error messages, library names where relevant
- Do NOT include dates, project names, or agent IDs
- Do NOT copy text verbatim from the chunk

Rules for summaries:
- Capture the key topic, action, or decision in ~20-30 words
- Include specific technical terms that someone might search for
- Do NOT include dates, project names, or agent IDs

SKIP rules: ONLY write "SKIP" if the chunk is entirely greetings, acknowledgements, or whitespace with absolutely no technical or topical content. If in doubt, do NOT skip.

${chunkTexts}

Respond with entries grouped by chunk number:
0:
- [query 1]
- [query 2]
- [query 3]
SUMMARY: [one-sentence summary]
1:
- [query 1]
- [query 2]
SUMMARY: [summary]
...`;
}

/**
 * Parse the LLM response into a map of chunk index → parsed entries.
 *
 * Handles various LLM output formats:
 * - "0:" header then "- query" bullets + "SUMMARY:" line
 * - "Chunk 0:" / "**Chunk 0:**" headers
 * - "0: - query" inline format
 * - "0: SKIP" for trivial chunks
 */
export function parseGenerationResponse(
  text: string,
  expectedCount: number,
): Map<number, ParsedChunkEntries> {
  const results = new Map<number, ParsedChunkEntries>();
  const lines = text.split('\n');

  let currentIndex = -1;

  const ensureEntry = (idx: number) => {
    if (!results.has(idx)) {
      results.set(idx, { summary: null, queries: [] });
    }
  };

  for (const line of lines) {
    // Match "0:", "Chunk 0:", "**Chunk 0:**", "## Chunk 0", etc. (header-only line)
    const indexMatch = line.match(
      /^(?:\*{0,2})?(?:#{0,3}\s*)?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:(?:\*{0,2})?\s*$/i,
    );
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      if (idx >= 0 && idx < expectedCount) {
        currentIndex = idx;
        ensureEntry(currentIndex);
      }
      continue;
    }

    // Handle "0: SKIP" or "Chunk 0: SKIP"
    const skipMatch = line.match(/^(?:\*{0,2})?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:\s*SKIP\s*$/i);
    if (skipMatch) {
      const idx = parseInt(skipMatch[1], 10);
      if (idx >= 0 && idx < expectedCount) {
        currentIndex = idx;
        // Don't add to results — SKIP means no entries
      }
      continue;
    }

    // Handle "0: - query" or "Chunk 0: - query" on same line
    const inlineMatch = line.match(/^(?:\*{0,2})?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:\s*[-•]\s*(.+)/i);
    if (inlineMatch) {
      const idx = parseInt(inlineMatch[1], 10);
      if (idx >= 0 && idx < expectedCount) {
        currentIndex = idx;
        ensureEntry(currentIndex);
        const query = inlineMatch[2].trim();
        if (query) {
          results.get(currentIndex)!.queries.push(query);
        }
      }
      continue;
    }

    // Handle SUMMARY: line (with or without ** bold)
    const summaryMatch = line.match(/^\s*(?:\*{0,2})?SUMMARY(?:\*{0,2})?:(?:\*{0,2})?\s*(.+)/i);
    if (summaryMatch && currentIndex >= 0 && currentIndex < expectedCount) {
      const summary = summaryMatch[1].trim();
      if (summary && summary.toUpperCase() !== 'SKIP') {
        ensureEntry(currentIndex);
        results.get(currentIndex)!.summary = summary;
      }
      continue;
    }

    // Bullet point under current chunk
    const queryMatch = line.match(/^\s*[-•]\s*(.+)/);
    if (queryMatch && currentIndex >= 0 && currentIndex < expectedCount) {
      const query = queryMatch[1].trim();
      if (query && query.toUpperCase() !== 'SKIP') {
        ensureEntry(currentIndex);
        results.get(currentIndex)!.queries.push(query);
      }
    }
  }

  return results;
}

/** Max retries for rate-limited or transient API errors. */
const MAX_RETRIES = 3;

/**
 * Call the API with exponential backoff on rate limit (429) and server errors (5xx).
 */
async function callWithRetry(
  client: Anthropic,
  model: string,
  prompt: string,
  batchSize: number,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create({
        model,
        max_tokens: Math.min(4096, Math.max(400, batchSize * 400)),
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const isRetryable = status === 429 || (status !== undefined && status >= 500);

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw error;
      }

      // Exponential backoff: 2s, 8s, 32s
      const backoffMs = 2000 * Math.pow(4, attempt);
      log.info(`API ${status} on attempt ${attempt + 1}, retrying in ${backoffMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('Retry loop exited unexpectedly');
}

/**
 * Get Anthropic client, returning null if no API key is available.
 */
async function getAnthropicClient(): Promise<Anthropic | null> {
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

  return new Anthropic();
}
