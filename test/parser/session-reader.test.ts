import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  readSession,
  readSessionMessages,
  getSessionInfo,
  deriveProjectSlug,
} from '../../src/parser/session-reader.js';
import type { SessionInfo } from '../../src/parser/types.js';

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

describe('deriveProjectSlug', () => {
  function makeInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
      sessionId: 'test-session',
      slug: '',
      cwd: '',
      messageCount: 10,
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T00:01:00Z',
      filePath: '/path/to/file.jsonl',
      ...overrides,
    };
  }

  it('derives slug from cwd basename', () => {
    const info = makeInfo({ cwd: '/Users/gvn/Dev/Apolitical/apolitical-assistant' });
    expect(deriveProjectSlug(info)).toBe('apolitical-assistant');
  });

  it('falls back to info.slug when cwd is empty', () => {
    const info = makeInfo({ slug: 'my-project' });
    expect(deriveProjectSlug(info)).toBe('my-project');
  });

  it('returns empty string when both cwd and slug are empty', () => {
    const info = makeInfo();
    expect(deriveProjectSlug(info)).toBe('');
  });

  it('prefers cwd over slug', () => {
    const info = makeInfo({ cwd: '/path/to/my-app', slug: 'different-slug' });
    expect(deriveProjectSlug(info)).toBe('my-app');
  });

  it('disambiguates when knownSlugs has collision', () => {
    const knownSlugs = new Map<string, string>();
    knownSlugs.set('api', '/Users/gvn/Work/api');

    const info = makeInfo({ cwd: '/Users/gvn/Personal/api' });
    const slug = deriveProjectSlug(info, knownSlugs);
    expect(slug).toBe('Personal/api');
  });

  it('does not disambiguate when same cwd', () => {
    const knownSlugs = new Map<string, string>();
    knownSlugs.set('api', '/Users/gvn/Work/api');

    const info = makeInfo({ cwd: '/Users/gvn/Work/api' });
    const slug = deriveProjectSlug(info, knownSlugs);
    expect(slug).toBe('api');
  });

  it('handles single-component path', () => {
    const info = makeInfo({ cwd: '/root' });
    expect(deriveProjectSlug(info)).toBe('root');
  });
});
