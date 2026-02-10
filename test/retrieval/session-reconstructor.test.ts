import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  setupTestDb,
  teardownTestDb,
} from '../storage/test-utils.js';
import {
  reconstructSession,
  resolveTimeWindow,
  applyTokenBudget,
  formatReconstruction,
} from '../../src/retrieval/session-reconstructor.js';
import type { StoredChunk } from '../../src/storage/types.js';
import type { ReconstructResult } from '../../src/retrieval/session-reconstructor.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

/**
 * Helper to create a minimal StoredChunk for unit tests (no DB needed).
 */
function makeChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    id: overrides.id ?? 'chunk-1',
    sessionId: overrides.sessionId ?? 'session-1',
    sessionSlug: overrides.sessionSlug ?? 'proj',
    turnIndices: overrides.turnIndices ?? [0],
    startTime: overrides.startTime ?? '2024-01-15T10:00:00Z',
    endTime: overrides.endTime ?? '2024-01-15T10:05:00Z',
    content: overrides.content ?? 'Test content',
    codeBlockCount: overrides.codeBlockCount ?? 0,
    toolUseCount: overrides.toolUseCount ?? 0,
    approxTokens: overrides.approxTokens ?? 100,
    createdAt: overrides.createdAt ?? '2024-01-15T10:00:00Z',
    agentId: overrides.agentId ?? null,
    vectorClock: overrides.vectorClock ?? null,
    spawnDepth: overrides.spawnDepth ?? 0,
    projectPath: overrides.projectPath ?? null,
  };
}

describe('resolveTimeWindow', () => {
  it('resolves daysBack to from/to', () => {
    const now = Date.now();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));

    const window = resolveTimeWindow({ project: 'proj', daysBack: 3 });
    expect(new Date(window.from).toISOString()).toBe('2024-06-12T12:00:00.000Z');
    expect(new Date(window.to).toISOString()).toBe('2024-06-15T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('resolves from/to directly', () => {
    const window = resolveTimeWindow({
      project: 'proj',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-16T00:00:00Z',
    });
    expect(window.from).toBe('2024-01-15T00:00:00Z');
    expect(window.to).toBe('2024-01-16T00:00:00Z');
  });

  it('resolves sessionId with wide time bounds', () => {
    const window = resolveTimeWindow({ project: 'proj', sessionId: 'abc123' });
    expect(window.sessionId).toBe('abc123');
    expect(window.from).toBe('1970-01-01T00:00:00Z');
  });

  it('resolves previousSession mode', () => {
    // Insert two sessions
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:30:00Z',
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's2',
      sessionSlug: 'proj',
      startTime: '2024-01-16T10:00:00Z',
      endTime: '2024-01-16T10:30:00Z',
    }));

    const window = resolveTimeWindow({
      project: 'proj',
      previousSession: true,
      currentSessionId: 's2',
    });
    expect(window.sessionId).toBe('s1');
    expect(window.from).toBe('2024-01-15T10:00:00Z');
  });

  it('returns empty window when no previous session', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:30:00Z',
    }));

    const window = resolveTimeWindow({
      project: 'proj',
      previousSession: true,
      currentSessionId: 's1',
    });
    expect(window.from).toBe('');
    expect(window.to).toBe('');
  });

  it('throws when previousSession is true but currentSessionId missing', () => {
    expect(() =>
      resolveTimeWindow({ project: 'proj', previousSession: true })
    ).toThrow('currentSessionId is required');
  });

  it('throws when no time window specified', () => {
    expect(() => resolveTimeWindow({ project: 'proj' })).toThrow(
      'Must specify one of'
    );
  });

  it('defaults from when only to is provided', () => {
    const window = resolveTimeWindow({ project: 'proj', to: '2024-01-16T00:00:00Z' });
    expect(window.from).toBe('1970-01-01T00:00:00Z');
    expect(window.to).toBe('2024-01-16T00:00:00Z');
  });

  it('defaults to when only from is provided', () => {
    const window = resolveTimeWindow({ project: 'proj', from: '2024-01-15T00:00:00Z' });
    expect(window.from).toBe('2024-01-15T00:00:00Z');
    expect(window.to).toBe('9999-12-31T23:59:59Z');
  });
});

describe('applyTokenBudget', () => {
  it('returns all chunks when under budget', () => {
    const chunks = [
      makeChunk({ id: 'c1', approxTokens: 100 }),
      makeChunk({ id: 'c2', approxTokens: 200 }),
    ];
    const { kept, truncated } = applyTokenBudget(chunks, 500, true);
    expect(kept).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('truncates oldest when keepNewest is true', () => {
    const chunks = [
      makeChunk({ id: 'c1', approxTokens: 100, startTime: '2024-01-15T10:00:00Z' }),
      makeChunk({ id: 'c2', approxTokens: 100, startTime: '2024-01-15T11:00:00Z' }),
      makeChunk({ id: 'c3', approxTokens: 100, startTime: '2024-01-15T12:00:00Z' }),
    ];
    const { kept, truncated } = applyTokenBudget(chunks, 200, true);
    expect(kept).toHaveLength(2);
    expect(kept[0].id).toBe('c2'); // Kept newer
    expect(kept[1].id).toBe('c3');
    expect(truncated).toBe(true);
  });

  it('truncates newest when keepNewest is false', () => {
    const chunks = [
      makeChunk({ id: 'c1', approxTokens: 100, startTime: '2024-01-15T10:00:00Z' }),
      makeChunk({ id: 'c2', approxTokens: 100, startTime: '2024-01-15T11:00:00Z' }),
      makeChunk({ id: 'c3', approxTokens: 100, startTime: '2024-01-15T12:00:00Z' }),
    ];
    const { kept, truncated } = applyTokenBudget(chunks, 200, false);
    expect(kept).toHaveLength(2);
    expect(kept[0].id).toBe('c1'); // Kept older
    expect(kept[1].id).toBe('c2');
    expect(truncated).toBe(true);
  });

  it('handles empty chunks array', () => {
    const { kept, truncated } = applyTokenBudget([], 1000, true);
    expect(kept).toHaveLength(0);
    expect(truncated).toBe(false);
  });

  it('handles zero budget', () => {
    const chunks = [makeChunk({ approxTokens: 100 })];
    const { kept, truncated } = applyTokenBudget(chunks, 0, true);
    expect(kept).toHaveLength(0);
    expect(truncated).toBe(true);
  });

  it('preserves chronological order after keepNewest truncation', () => {
    const chunks = [
      makeChunk({ id: 'c1', approxTokens: 50 }),
      makeChunk({ id: 'c2', approxTokens: 50 }),
      makeChunk({ id: 'c3', approxTokens: 50 }),
      makeChunk({ id: 'c4', approxTokens: 50 }),
    ];
    const { kept } = applyTokenBudget(chunks, 150, true);
    expect(kept).toHaveLength(3);
    expect(kept[0].id).toBe('c2');
    expect(kept[1].id).toBe('c3');
    expect(kept[2].id).toBe('c4');
  });
});

describe('formatReconstruction', () => {
  it('formats empty result', () => {
    const result: ReconstructResult = {
      chunks: [],
      sessions: [],
      totalTokens: 0,
      truncated: false,
      timeRange: { from: '', to: '' },
    };
    expect(formatReconstruction(result)).toBe(
      'No session data found for the specified time range.'
    );
  });

  it('includes session boundary markers', () => {
    const result: ReconstructResult = {
      chunks: [
        { id: 'c1', sessionId: 's1', content: 'chunk 1 content', startTime: '2024-01-15T10:00:00Z', approxTokens: 100 },
        { id: 'c2', sessionId: 's1', content: 'chunk 2 content', startTime: '2024-01-15T10:10:00Z', approxTokens: 100 },
      ],
      sessions: [
        { sessionId: 's1', firstChunkTime: '2024-01-15T10:00:00Z', lastChunkTime: '2024-01-15T10:10:00Z', chunkCount: 2, totalTokens: 200 },
      ],
      totalTokens: 200,
      truncated: false,
      timeRange: { from: '2024-01-15T00:00:00Z', to: '2024-01-16T00:00:00Z' },
    };

    const text = formatReconstruction(result);
    expect(text).toContain('=== Session s1');
    expect(text).toContain('chunk 1 content');
    expect(text).toContain('chunk 2 content');
    expect(text).toContain('2 chunks from 1 session(s)');
  });

  it('includes truncation notice when truncated', () => {
    const result: ReconstructResult = {
      chunks: [
        { id: 'c1', sessionId: 's1', content: 'content', startTime: '2024-01-15T10:00:00Z', approxTokens: 100 },
      ],
      sessions: [
        { sessionId: 's1', firstChunkTime: '2024-01-15T10:00:00Z', lastChunkTime: '2024-01-15T10:00:00Z', chunkCount: 1, totalTokens: 100 },
      ],
      totalTokens: 100,
      truncated: true,
      timeRange: { from: '2024-01-15T00:00:00Z', to: '2024-01-16T00:00:00Z' },
    };

    const text = formatReconstruction(result);
    expect(text).toContain('[truncated to fit token budget]');
  });

  it('adds session headers when chunks span multiple sessions', () => {
    const result: ReconstructResult = {
      chunks: [
        { id: 'c1', sessionId: 's1', content: 'session 1 chunk', startTime: '2024-01-15T10:00:00Z', approxTokens: 100 },
        { id: 'c2', sessionId: 's2', content: 'session 2 chunk', startTime: '2024-01-16T10:00:00Z', approxTokens: 100 },
      ],
      sessions: [
        { sessionId: 's1', firstChunkTime: '2024-01-15T10:00:00Z', lastChunkTime: '2024-01-15T10:00:00Z', chunkCount: 1, totalTokens: 100 },
        { sessionId: 's2', firstChunkTime: '2024-01-16T10:00:00Z', lastChunkTime: '2024-01-16T10:00:00Z', chunkCount: 1, totalTokens: 100 },
      ],
      totalTokens: 200,
      truncated: false,
      timeRange: { from: '2024-01-15T00:00:00Z', to: '2024-01-17T00:00:00Z' },
    };

    const text = formatReconstruction(result);
    expect(text).toContain('=== Session s1');
    expect(text).toContain('=== Session s2');
    expect(text).toContain('2 chunks from 2 session(s)');
  });
});

describe('reconstructSession (integration)', () => {
  it('reconstructs by from/to time range', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'First chunk content',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:05:00Z',
      approxTokens: 100,
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'Second chunk content',
      startTime: '2024-01-15T10:10:00Z',
      endTime: '2024-01-15T10:15:00Z',
      approxTokens: 150,
    }));

    const result = reconstructSession({
      project: 'proj',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-16T00:00:00Z',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.sessions).toHaveLength(1);
    expect(result.totalTokens).toBe(250);
    expect(result.truncated).toBe(false);
  });

  it('reconstructs by sessionId', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:05:00Z',
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's2',
      sessionSlug: 'proj',
      startTime: '2024-01-15T11:00:00Z',
      endTime: '2024-01-15T11:05:00Z',
    }));

    const result = reconstructSession({
      project: 'proj',
      sessionId: 's1',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].sessionId).toBe('s1');
  });

  it('reconstructs previous session', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'Previous session work',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:30:00Z',
      approxTokens: 200,
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's2',
      sessionSlug: 'proj',
      content: 'Current session work',
      startTime: '2024-01-16T10:00:00Z',
      endTime: '2024-01-16T10:30:00Z',
    }));

    const result = reconstructSession({
      project: 'proj',
      previousSession: true,
      currentSessionId: 's2',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toBe('Previous session work');
  });

  it('returns empty result when no previous session', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:30:00Z',
    }));

    const result = reconstructSession({
      project: 'proj',
      previousSession: true,
      currentSessionId: 's1',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(0);
    expect(result.sessions).toHaveLength(0);
  });

  it('applies token budget and truncates oldest by default', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'Old chunk',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:05:00Z',
      approxTokens: 100,
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'New chunk',
      startTime: '2024-01-15T10:10:00Z',
      endTime: '2024-01-15T10:15:00Z',
      approxTokens: 100,
    }));

    const result = reconstructSession({
      project: 'proj',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-16T00:00:00Z',
      maxTokens: 100,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toBe('New chunk');
    expect(result.truncated).toBe(true);
  });

  it('truncates newest when keepNewest is false', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'Old chunk',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:05:00Z',
      approxTokens: 100,
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'New chunk',
      startTime: '2024-01-15T10:10:00Z',
      endTime: '2024-01-15T10:15:00Z',
      approxTokens: 100,
    }));

    const result = reconstructSession({
      project: 'proj',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-16T00:00:00Z',
      maxTokens: 100,
      keepNewest: false,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toBe('Old chunk');
    expect(result.truncated).toBe(true);
  });

  it('handles cross-session reconstruction', () => {
    insertTestChunk(db, createSampleChunk({
      id: 'c1',
      sessionId: 's1',
      sessionSlug: 'proj',
      content: 'Session 1 content',
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T10:05:00Z',
      approxTokens: 100,
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'c2',
      sessionId: 's2',
      sessionSlug: 'proj',
      content: 'Session 2 content',
      startTime: '2024-01-16T10:00:00Z',
      endTime: '2024-01-16T10:05:00Z',
      approxTokens: 100,
    }));

    const result = reconstructSession({
      project: 'proj',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-17T00:00:00Z',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.sessions).toHaveLength(2);
    expect(result.chunks[0].sessionId).toBe('s1');
    expect(result.chunks[1].sessionId).toBe('s2');
  });

  it('returns empty result for no matching chunks', () => {
    const result = reconstructSession({
      project: 'nonexistent',
      from: '2024-01-15T00:00:00Z',
      to: '2024-01-16T00:00:00Z',
      maxTokens: 10000,
    });

    expect(result.chunks).toHaveLength(0);
    expect(result.sessions).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });
});
