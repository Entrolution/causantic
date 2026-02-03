import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSessionMessages } from '../../src/parser/session-reader.js';
import { assembleTurns } from '../../src/parser/turn-assembler.js';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-session.jsonl');

describe('assembleTurns', () => {
  it('groups messages into turns', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    expect(turns.length).toBeGreaterThan(0);
    // The fixture has 4 user text messages, so 4 turns
    expect(turns.length).toBe(4);
  });

  it('extracts user text from string content', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    expect(turns[0].userText).toBe('How do I read a file in Node.js?');
  });

  it('captures tool exchanges', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    // Turn 2 (project structure) has a Glob tool use
    const structureTurn = turns[1];
    expect(structureTurn.toolExchanges.length).toBe(1);
    expect(structureTurn.toolExchanges[0].toolName).toBe('Glob');
    expect(structureTurn.toolExchanges[0].result).toContain('src/index.ts');
  });

  it('detects thinking blocks', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    // Turn 2 has a thinking block
    expect(turns[1].hasThinking).toBe(true);
    // Turn 1 does not
    expect(turns[0].hasThinking).toBe(false);
  });

  it('assigns sequential indices', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    for (let i = 0; i < turns.length; i++) {
      expect(turns[i].index).toBe(i);
    }
  });

  it('does not start a new turn on tool_result-only user messages', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const turns = assembleTurns(messages);

    // Tool result user messages should be grouped with their parent turn
    // not create new turns. 4 real user messages = 4 turns.
    expect(turns.length).toBe(4);
  });
});
