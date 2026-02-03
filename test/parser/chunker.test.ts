import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { readSessionMessages } from '../../src/parser/session-reader.js';
import { assembleTurns } from '../../src/parser/turn-assembler.js';
import { chunkTurns, renderTurn, resetChunkCounter } from '../../src/parser/chunker.js';
import { approximateTokens } from '../../src/utils/token-counter.js';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-session.jsonl');

describe('renderTurn', () => {
  it('renders user and assistant text with markers', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const text = renderTurn(turns[0]);

    expect(text).toContain('[User]');
    expect(text).toContain('[Assistant]');
    expect(text).toContain('How do I read a file');
    expect(text).toContain('fs module');
  });

  it('includes tool markers in full mode', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const text = renderTurn(turns[1], 'full');

    expect(text).toContain('[Tool:Glob]');
    expect(text).toContain('[Result:Glob]');
  });

  it('excludes thinking when disabled', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const withThinking = renderTurn(turns[1], 'full', true);
    const withoutThinking = renderTurn(turns[1], 'full', false);

    expect(withThinking).toContain('[Thinking]');
    expect(withoutThinking).not.toContain('[Thinking]');
  });
});

describe('chunkTurns', () => {
  beforeEach(() => {
    resetChunkCounter();
  });

  it('produces chunks from turns', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const chunks = chunkTurns(turns, {
      sessionId: 'sess-001',
      sessionSlug: 'test-session',
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.text).toBeTruthy();
      expect(chunk.metadata.sessionId).toBe('sess-001');
    }
  });

  it('respects maxTokens limit', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const chunks = chunkTurns(turns, {
      maxTokens: 200,
      sessionId: 'sess-001',
      sessionSlug: 'test-session',
    });

    // Each chunk should be at or near the limit
    for (const chunk of chunks) {
      // Allow some overshoot since we don't split mid-section
      expect(approximateTokens(chunk.text)).toBeLessThan(400);
    }
  });

  it('merges small turns', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const chunks = chunkTurns(turns, {
      maxTokens: 8000,
      minTokens: 500,
      sessionId: 'sess-001',
      sessionSlug: 'test-session',
    });

    // With high minTokens, small turns should be merged
    expect(chunks.length).toBeLessThanOrEqual(turns.length);
  });

  it('sets metadata correctly', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);
    const chunks = chunkTurns(turns, {
      sessionId: 'sess-001',
      sessionSlug: 'test-session',
    });

    for (const chunk of chunks) {
      expect(chunk.metadata.turnIndices.length).toBeGreaterThan(0);
      expect(chunk.metadata.startTime).toBeTruthy();
      expect(chunk.metadata.approxTokens).toBeGreaterThan(0);
    }
  });
});
