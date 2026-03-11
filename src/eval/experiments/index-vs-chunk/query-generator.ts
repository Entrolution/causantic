/**
 * Generate natural language search queries from chunks using LLM.
 *
 * Each query is something a user might search for that should find
 * the source chunk. The LLM sees a truncated chunk and generates
 * a plausible search query.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createSecretStore } from '../../../utils/secret-store.js';
import type { BenchmarkQuery } from './types.js';

/** Chunk data for query generation. */
export interface ChunkForQueryGen {
  id: string;
  sessionSlug: string;
  content: string;
  clusterId: string;
  clusterName: string | null;
}

/**
 * Generate search queries for a batch of chunks.
 *
 * Batches up to 10 chunks per API call to keep cost low.
 */
export async function generateSearchQueries(
  chunks: ChunkForQueryGen[],
  model: string,
): Promise<BenchmarkQuery[]> {
  const client = await getClient();
  if (!client) {
    throw new Error('No Anthropic API key available');
  }

  const results: BenchmarkQuery[] = [];
  const batchSize = 10;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const queries = await generateBatch(client, batch, model);
    results.push(...queries);
  }

  return results;
}

async function generateBatch(
  client: Anthropic,
  chunks: ChunkForQueryGen[],
  model: string,
): Promise<BenchmarkQuery[]> {
  const maxContentChars = 500 * 4; // ~500 tokens per chunk

  const chunkTexts = chunks
    .map((c, i) => {
      const content =
        c.content.length > maxContentChars
          ? c.content.slice(0, maxContentChars) + '\n...[truncated]'
          : c.content;
      return `--- Chunk ${i} ---\n${content}`;
    })
    .join('\n\n');

  const prompt = `You are generating natural language search queries for a retrieval benchmark. For each conversation chunk below, write a short search query (5-15 words) that a user would type to find this specific chunk.

Requirements:
- The query should be something a real user would search for
- It should target the SPECIFIC content of this chunk, not the general topic
- Use natural language, not keywords
- Do NOT quote or copy text directly from the chunk
- Focus on the key decision, action, or outcome in the chunk

${chunkTexts}

Respond with exactly ${chunks.length} queries, one per line, prefixed with the chunk number:
0: [query]
1: [query]
...`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(2048, chunks.length * 100),
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const queries = parseResponse(text, chunks.length);

    return chunks
      .map((chunk, i) => {
        const query = queries[i];
        if (!query) return null;
        return {
          query,
          groundTruthChunkId: chunk.id,
          sessionSlug: chunk.sessionSlug,
          clusterId: chunk.clusterId,
          clusterName: chunk.clusterName,
        };
      })
      .filter((q): q is BenchmarkQuery => q !== null);
  } catch (error) {
    console.warn(
      `  Query generation batch failed: ${(error as Error).message}`,
    );
    return [];
  }
}

function parseResponse(
  text: string,
  expectedCount: number,
): (string | null)[] {
  const queries: (string | null)[] = new Array(expectedCount).fill(null);
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\d+):\s*(.+)/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index >= 0 && index < expectedCount) {
        queries[index] = match[2].trim();
      }
    }
  }

  return queries;
}

async function getClient(): Promise<Anthropic | null> {
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

  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}
