import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSession, readSessionMessages, getSessionInfo } from '../../src/parser/session-reader.js';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-session.jsonl');

describe('readSession', () => {
  it('filters out progress and file-history-snapshot by default', async () => {
    const messages = await readSessionMessages(FIXTURE);
    for (const msg of messages) {
      expect(msg.type).not.toBe('progress');
      expect(msg.type).not.toBe('file-history-snapshot');
    }
  });

  it('returns only user and assistant messages', async () => {
    const messages = await readSessionMessages(FIXTURE);
    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(['user', 'assistant']).toContain(msg.type);
    }
  });

  it('includes noise types when requested', async () => {
    const messages = await readSessionMessages(FIXTURE, { includeNoise: true });
    const types = new Set(messages.map((m) => m.type));
    expect(types.has('progress')).toBe(true);
  });

  it('preserves message ordering', async () => {
    const messages = await readSessionMessages(FIXTURE);
    const timestamps = messages.map((m) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('async generator yields messages one at a time', async () => {
    let count = 0;
    for await (const msg of readSession(FIXTURE)) {
      count++;
      expect(msg.uuid).toBeDefined();
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe('getSessionInfo', () => {
  it('extracts session metadata', async () => {
    const info = await getSessionInfo(FIXTURE);
    expect(info.sessionId).toBe('sess-001');
    expect(info.slug).toBe('test-session');
    expect(info.messageCount).toBeGreaterThan(0);
    expect(info.startTime).toBeTruthy();
    expect(info.endTime).toBeTruthy();
  });
});
