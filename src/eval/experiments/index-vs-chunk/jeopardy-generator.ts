/**
 * "Jeopardy-style" index entry generation.
 *
 * Instead of generating summaries of chunk content, generates the
 * natural language queries that would have this chunk as the right answer.
 *
 * The key insight: a search index entry should embed close to the
 * QUERIES that should find the chunk, not close to the chunk content itself.
 * Like Jeopardy — given the answer (chunk), produce the questions.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createSecretStore } from '../../../utils/secret-store.js';

/** Generated search targets for a chunk. */
export interface JeopardyEntry {
  chunkId: string;
  /** 2-3 search target questions per chunk. */
  queries: string[];
}

/**
 * Generate Jeopardy-style search targets for a batch of chunks.
 *
 * Returns 2-3 specific search queries per chunk — things a user
 * would type that should find this chunk as the answer.
 */
export async function generateJeopardyEntries(
  chunks: Array<{ id: string; content: string }>,
  model: string,
  onProgress?: (done: number, total: number) => void,
): Promise<JeopardyEntry[]> {
  const client = await getClient();
  if (!client) {
    throw new Error('No Anthropic API key available');
  }

  const results: JeopardyEntry[] = [];
  const batchSize = 8; // smaller batches — more output per chunk

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const entries = await generateBatch(client, batch, model);
    results.push(...entries);
    onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length);
  }

  return results;
}

async function generateBatch(
  client: Anthropic,
  chunks: Array<{ id: string; content: string }>,
  model: string,
): Promise<JeopardyEntry[]> {
  const maxContentChars = 500 * 4;

  const chunkTexts = chunks
    .map((c, i) => {
      const content =
        c.content.length > maxContentChars
          ? c.content.slice(0, maxContentChars) + '\n...[truncated]'
          : c.content;
      return `--- Chunk ${i} ---\n${content}`;
    })
    .join('\n\n');

  const prompt = `You are building a search index. For each conversation chunk below, write 2-3 specific search queries that a user would type when they need the information in this chunk.

Think of it like Jeopardy: the chunk is the "answer" — what are the "questions"?

Rules:
- Each query should be a natural question or search phrase (5-20 words)
- Queries must be SPECIFIC enough to uniquely target THIS chunk, not the general topic
- Focus on the concrete outcome, decision, error, or technique — not the topic category
- Include specific names: file paths, function names, error messages, library names where relevant
- Do NOT include dates, project names, or agent IDs
- Do NOT copy text verbatim from the chunk
- If the chunk is trivial (just greetings, acknowledgements, or boilerplate), write "SKIP"

${chunkTexts}

Respond with queries grouped by chunk number:
0:
- [query 1]
- [query 2]
- [query 3]
1:
- [query 1]
- [query 2]
...`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, chunks.length * 300),
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    return parseResponse(text, chunks);
  } catch (error) {
    console.warn(
      `  Jeopardy batch failed: ${(error as Error).message}`,
    );
    return [];
  }
}

function parseResponse(
  text: string,
  chunks: Array<{ id: string; content: string }>,
): JeopardyEntry[] {
  const results: JeopardyEntry[] = [];
  const lines = text.split('\n');

  let currentIndex = -1;
  let currentQueries: string[] = [];

  const flush = () => {
    if (
      currentIndex >= 0 &&
      currentIndex < chunks.length &&
      currentQueries.length > 0 &&
      !currentQueries.some((q) => q.toUpperCase() === 'SKIP')
    ) {
      results.push({
        chunkId: chunks[currentIndex].id,
        queries: currentQueries,
      });
    }
    currentQueries = [];
  };

  for (const line of lines) {
    // Match "0:", "Chunk 0:", "**Chunk 0:**", "## Chunk 0", etc.
    const indexMatch = line.match(/^(?:\*{0,2})?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:\s*$/i);
    if (indexMatch) {
      flush();
      currentIndex = parseInt(indexMatch[1], 10);
      continue;
    }

    // Handle "0: - query" or "Chunk 0: - query" on same line
    const inlineMatch = line.match(/^(?:\*{0,2})?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:\s*-\s*(.+)/i);
    if (inlineMatch) {
      flush();
      currentIndex = parseInt(inlineMatch[1], 10);
      const query = inlineMatch[2].trim();
      if (query && query.toUpperCase() !== 'SKIP') {
        currentQueries.push(query);
      }
      continue;
    }

    // Handle "0: SKIP" or "Chunk 0: SKIP"
    const skipMatch = line.match(/^(?:\*{0,2})?(?:Chunk\s+)?(\d+)(?:\*{0,2})?:\s*SKIP\s*$/i);
    if (skipMatch) {
      flush();
      currentIndex = parseInt(skipMatch[1], 10);
      currentQueries = ['SKIP'];
      continue;
    }

    const queryMatch = line.match(/^\s*[-•]\s*(.+)/);
    if (queryMatch && currentIndex >= 0) {
      const query = queryMatch[1].trim();
      if (query && query.toUpperCase() !== 'SKIP') {
        currentQueries.push(query);
      }
    }
  }

  flush();
  return results;
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
