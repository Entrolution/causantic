/**
 * Tests for hybrid jeopardy + summary index entry generation parser.
 */

import { describe, it, expect } from 'vitest';
import {
  parseGenerationResponse,
  buildGenerationPrompt,
} from '../../src/index-entries/index-generator.js';

describe('parseGenerationResponse', () => {
  it('parses well-formed output with queries and summary', () => {
    const text = `0:
- How to configure ESLint with TypeScript?
- What ESLint plugins work best for TypeScript projects?
- How to resolve ESLint conflicts with Prettier?
SUMMARY: Configuring ESLint for a TypeScript project with Prettier integration and plugin selection.
1:
- How to set up HDBSCAN clustering on embeddings?
- What parameters control HDBSCAN min cluster size?
- How does HDBSCAN handle noise points in embedding space?
SUMMARY: Setting up HDBSCAN clustering for chunk embeddings with parameter tuning.`;

    const result = parseGenerationResponse(text, 2);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBe(
      'Configuring ESLint for a TypeScript project with Prettier integration and plugin selection.',
    );
    expect(result.get(1)!.queries).toHaveLength(3);
    expect(result.get(1)!.summary).toContain('HDBSCAN');
  });

  it('handles output with queries but no summary', () => {
    const text = `0:
- How to implement rate limiting?
- What rate limiting approach works for API calls?
- How to throttle concurrent requests?`;

    const result = parseGenerationResponse(text, 1);

    expect(result.size).toBe(1);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeNull();
  });

  it('handles 4-5 queries per chunk', () => {
    const text = `0:
- Query one about vector stores
- Query two about embedding models
- Query three about cosine similarity
- Query four about approximate nearest neighbors
- Query five about HNSW index parameters
SUMMARY: Vector store configuration and embedding search optimization.`;

    const result = parseGenerationResponse(text, 1);

    expect(result.get(0)!.queries).toHaveLength(5);
    expect(result.get(0)!.summary).toBeTruthy();
  });

  it('handles SKIP for trivial chunks', () => {
    const text = `0:
- How to implement rate limiting?
- What rate limiting approach works for API calls?
- How to configure per-endpoint limits?
SUMMARY: Implementing API rate limiting with per-endpoint configuration.
1: SKIP
2:
- How to fix database migration errors?
- What causes migration version conflicts?
- How to rollback a failed migration?
SUMMARY: Debugging and rolling back failed database migrations.`;

    const result = parseGenerationResponse(text, 3);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeTruthy();
    expect(result.has(1)).toBe(false);
    expect(result.get(2)!.queries).toHaveLength(3);
  });

  it('handles "Chunk N:" header format', () => {
    const text = `Chunk 0:
- How does the embedder handle batch processing?
- What embedding model is used for index entries?
- How to configure batch size for embeddings?
SUMMARY: Batch processing configuration for the embedding pipeline.
Chunk 1:
- How to debug graph traversal weight accumulation?
- What algorithm drives backward edge walking?
- How are edge weights decayed over time?
SUMMARY: Graph traversal debugging and edge weight decay mechanics.`;

    const result = parseGenerationResponse(text, 2);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeTruthy();
    expect(result.get(1)!.queries).toHaveLength(3);
    expect(result.get(1)!.summary).toBeTruthy();
  });

  it('handles bold "**Chunk N:**" header format', () => {
    const text = `**Chunk 0:**
- Query about vector store configuration
- Query about embedding dimensions
- Query about distance metrics
SUMMARY: Vector store setup with embedding dimensions and distance metric selection.
**Chunk 1:**
- Query about edge weight decay
- Query about time-based decay functions
- Query about hop penalty configuration
SUMMARY: Edge weight decay configuration with time and hop penalties.`;

    const result = parseGenerationResponse(text, 2);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeTruthy();
    expect(result.get(1)!.queries).toHaveLength(3);
  });

  it('handles inline "N: - query" format', () => {
    const text = `0: - How to configure the semantic index?
0: - What settings control index entry generation?
0: - How to tune index refresh batch size?
SUMMARY: Semantic index configuration and batch refresh settings.
1: - How to run database migrations?
1: - What triggers automatic migration on startup?
1: - How to add a new migration version?
SUMMARY: Database migration execution and version management.`;

    const result = parseGenerationResponse(text, 2);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toEqual([
      'How to configure the semantic index?',
      'What settings control index entry generation?',
      'How to tune index refresh batch size?',
    ]);
    expect(result.get(0)!.summary).toBeTruthy();
    expect(result.get(1)!.queries).toHaveLength(3);
  });

  it('handles "Chunk N: SKIP" format', () => {
    const text = `Chunk 0: SKIP
Chunk 1:
- How to handle API rate limits in batch processing?
- What happens when the rate limiter queue fills up?
- How to configure per-minute API call limits?
SUMMARY: API rate limiting configuration for batch processing.`;

    const result = parseGenerationResponse(text, 2);

    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(false);
    expect(result.get(1)!.queries).toHaveLength(3);
    expect(result.get(1)!.summary).toBeTruthy();
  });

  it('returns empty map for empty response', () => {
    const result = parseGenerationResponse('', 3);
    expect(result.size).toBe(0);
  });

  it('returns empty map for unparseable response', () => {
    const result = parseGenerationResponse('This is just some random text\nwith no structure', 3);
    expect(result.size).toBe(0);
  });

  it('ignores out-of-range chunk indices', () => {
    const text = `0:
- Valid query for chunk 0
- Another valid query
- Third valid query
SUMMARY: Summary for chunk 0.
5:
- This chunk index is out of range
1:
- Valid query for chunk 1
- Another valid query
- Third valid query
SUMMARY: Summary for chunk 1.`;

    const result = parseGenerationResponse(text, 3);

    expect(result.size).toBe(2);
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(true);
    expect(result.has(5)).toBe(false);
  });

  it('handles partial/truncated response (only some chunks)', () => {
    const text = `0:
- How to implement causal graph traversal?
- What algorithm is used for backward edge walking?
- How are traversal weights accumulated across paths?
SUMMARY: Causal graph traversal with backward edge walking and weight accumulation.
1:
- How to configure cluster refresh schedules?
- What triggers automatic cluster recalculation?
- How to set cluster refresh rate limits?
SUMMARY: Cluster refresh scheduling and rate limit configuration.`;

    // Expected 5 chunks but only got 2
    const result = parseGenerationResponse(text, 5);

    expect(result.size).toBe(2);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeTruthy();
    expect(result.get(1)!.queries).toHaveLength(3);
  });

  it('handles bullet points with bullet character (•)', () => {
    const text = `0:
• How does the token counter estimate chunk size?
• What approximation method is used for token counting?
• How accurate is the character-to-token ratio?
SUMMARY: Token counting approximation using character-to-token ratio estimation.`;

    const result = parseGenerationResponse(text, 1);

    expect(result.size).toBe(1);
    expect(result.get(0)!.queries).toHaveLength(3);
    expect(result.get(0)!.summary).toBeTruthy();
  });

  it('strips SKIP bullet points within a chunk', () => {
    const text = `0:
- How to configure logging levels?
- How to enable debug output for specific modules?
- How to route logs to file vs console?
SUMMARY: Logging level configuration with module-specific debug output.
1:
- SKIP`;

    const result = parseGenerationResponse(text, 2);

    expect(result.get(0)!.queries).toHaveLength(3);
    // Chunk 1 has only a SKIP bullet — filtered out, so empty array
    expect(result.get(1)!.queries).toEqual([]);
  });

  it('handles bold SUMMARY prefix', () => {
    const text = `0:
- Query about migration testing
- Query about schema validation
- Query about rollback procedures
**SUMMARY:** Testing database migrations with schema validation and rollback support.`;

    const result = parseGenerationResponse(text, 1);

    expect(result.get(0)!.summary).toBe(
      'Testing database migrations with schema validation and rollback support.',
    );
  });
});

describe('buildGenerationPrompt', () => {
  it('includes all chunks with correct numbering', () => {
    const chunks = [
      { index: 0, content: 'First chunk content', id: 'id-0' },
      { index: 1, content: 'Second chunk content', id: 'id-1' },
    ];

    const prompt = buildGenerationPrompt(chunks);

    expect(prompt).toContain('--- Chunk 0 ---');
    expect(prompt).toContain('First chunk content');
    expect(prompt).toContain('--- Chunk 1 ---');
    expect(prompt).toContain('Second chunk content');
  });

  it('includes Jeopardy framing and summary request', () => {
    const chunks = [{ index: 0, content: 'Some content', id: 'id-0' }];
    const prompt = buildGenerationPrompt(chunks);

    expect(prompt).toContain('Jeopardy');
    expect(prompt).toContain('3-5 search queries');
    expect(prompt).toContain('1 summary');
    expect(prompt).toContain('SUMMARY:');
  });

  it('mentions AI agents as callers', () => {
    const chunks = [{ index: 0, content: 'Some content', id: 'id-0' }];
    const prompt = buildGenerationPrompt(chunks);

    expect(prompt).toContain('AI agents');
  });

  it('has strict SKIP rules', () => {
    const chunks = [{ index: 0, content: 'Some content', id: 'id-0' }];
    const prompt = buildGenerationPrompt(chunks);

    expect(prompt).toContain('ONLY write "SKIP"');
    expect(prompt).toContain('If in doubt, do NOT skip');
  });
});
