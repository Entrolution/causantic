import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  setupTestDb,
  teardownTestDb,
} from './test-utils.js';
import {
  getChunksByTimeRange,
  getChunksBefore,
  getSessionsForProject,
  getPreviousSession,
} from '../../src/storage/chunk-store.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

describe('getChunksByTimeRange', () => {
  it('returns chunks within the time window', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:10:00Z',
        endTime: '2024-01-15T10:15:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c3',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-16T10:00:00Z',
        endTime: '2024-01-16T10:05:00Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe('c1');
    expect(chunks[1].id).toBe('c2');
  });

  it('excludes chunks outside the time window', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-14T23:59:00Z',
        endTime: '2024-01-14T23:59:59Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(chunks).toHaveLength(0);
  });

  it('filters by project slug', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj-a',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj-b',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj-a', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('c1');
  });

  it('filters by sessionId when provided', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:10:00Z',
        endTime: '2024-01-15T10:15:00Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z', {
      sessionId: 's1',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('c1');
  });

  it('respects limit option', () => {
    for (let i = 0; i < 5; i++) {
      insertTestChunk(
        db,
        createSampleChunk({
          id: `c${i}`,
          sessionId: 's1',
          sessionSlug: 'proj',
          startTime: `2024-01-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
          endTime: `2024-01-15T${String(10 + i).padStart(2, '0')}:05:00Z`,
        }),
      );
    }

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z', {
      limit: 3,
    });
    expect(chunks).toHaveLength(3);
  });

  it('returns chunks ordered by start_time ASC', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T11:00:00Z',
        endTime: '2024-01-15T11:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(chunks[0].id).toBe('c1');
    expect(chunks[1].id).toBe('c2');
  });

  it('uses exclusive upper bound (start_time < to)', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-16T00:00:00Z',
        endTime: '2024-01-16T00:05:00Z',
      }),
    );

    const chunks = getChunksByTimeRange('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(chunks).toHaveLength(0);
  });
});

describe('getChunksBefore', () => {
  it('returns chunks before timestamp in chronological order', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T11:00:00Z',
        endTime: '2024-01-15T11:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c3',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T12:00:00Z',
        endTime: '2024-01-15T12:05:00Z',
      }),
    );

    const chunks = getChunksBefore('proj', '2024-01-15T12:30:00Z', 10);
    expect(chunks).toHaveLength(3);
    // Chronological order (oldest first)
    expect(chunks[0].id).toBe('c1');
    expect(chunks[1].id).toBe('c2');
    expect(chunks[2].id).toBe('c3');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      insertTestChunk(
        db,
        createSampleChunk({
          id: `c${i}`,
          sessionId: 's1',
          sessionSlug: 'proj',
          startTime: `2024-01-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
          endTime: `2024-01-15T${String(10 + i).padStart(2, '0')}:05:00Z`,
        }),
      );
    }

    const chunks = getChunksBefore('proj', '2024-01-16T00:00:00Z', 3);
    expect(chunks).toHaveLength(3);
    // Should be the 3 most recent, in chronological order
    expect(chunks[0].id).toBe('c2');
    expect(chunks[1].id).toBe('c3');
    expect(chunks[2].id).toBe('c4');
  });

  it('returns empty array when no chunks before timestamp', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const chunks = getChunksBefore('proj', '2024-01-15T09:00:00Z', 10);
    expect(chunks).toHaveLength(0);
  });

  it('scoped to project (session_slug)', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj-a',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj-b',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const chunks = getChunksBefore('proj-a', '2024-01-16T00:00:00Z', 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('c1');
  });
});

describe('getSessionsForProject', () => {
  it('returns sessions with aggregated metadata', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
        approxTokens: 100,
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:10:00Z',
        endTime: '2024-01-15T10:15:00Z',
        approxTokens: 200,
      }),
    );

    const sessions = getSessionsForProject('proj');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s1');
    expect(sessions[0].chunkCount).toBe(2);
    expect(sessions[0].totalTokens).toBe(300);
    expect(sessions[0].firstChunkTime).toBe('2024-01-15T10:00:00Z');
    expect(sessions[0].lastChunkTime).toBe('2024-01-15T10:15:00Z');
  });

  it('returns multiple sessions ordered by firstChunkTime DESC', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-16T10:00:00Z',
        endTime: '2024-01-16T10:05:00Z',
      }),
    );

    const sessions = getSessionsForProject('proj');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('s2'); // Newer first
    expect(sessions[1].sessionId).toBe('s1');
  });

  it('filters by time range when from/to provided', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-14T10:00:00Z',
        endTime: '2024-01-14T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const sessions = getSessionsForProject('proj', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s2');
  });

  it('filters by project slug', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj-a',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj-b',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:05:00Z',
      }),
    );

    const sessions = getSessionsForProject('proj-a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s1');
  });

  it('returns empty array when no sessions exist', () => {
    const sessions = getSessionsForProject('nonexistent');
    expect(sessions).toHaveLength(0);
  });
});

describe('getPreviousSession', () => {
  it('finds the most recent session before the current one', () => {
    // Session 1 (older)
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
        approxTokens: 150,
      }),
    );
    // Session 2 (current)
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-16T10:00:00Z',
        endTime: '2024-01-16T10:30:00Z',
      }),
    );

    const prev = getPreviousSession('proj', 's2');
    expect(prev).not.toBeNull();
    expect(prev!.sessionId).toBe('s1');
    expect(prev!.totalTokens).toBe(150);
  });

  it('returns null when there is no previous session', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
      }),
    );

    const prev = getPreviousSession('proj', 's1');
    expect(prev).toBeNull();
  });

  it('returns null when current session does not exist', () => {
    const prev = getPreviousSession('proj', 'nonexistent');
    expect(prev).toBeNull();
  });

  it('skips sessions from different projects', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'other-proj',
        startTime: '2024-01-14T10:00:00Z',
        endTime: '2024-01-14T10:30:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-16T10:00:00Z',
        endTime: '2024-01-16T10:30:00Z',
      }),
    );

    const prev = getPreviousSession('proj', 's2');
    expect(prev).toBeNull();
  });

  it('picks the most recent of multiple previous sessions', () => {
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj',
        startTime: '2024-01-14T10:00:00Z',
        endTime: '2024-01-14T10:30:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's2',
        sessionSlug: 'proj',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c3',
        sessionId: 's3',
        sessionSlug: 'proj',
        startTime: '2024-01-16T10:00:00Z',
        endTime: '2024-01-16T10:30:00Z',
      }),
    );

    const prev = getPreviousSession('proj', 's3');
    expect(prev).not.toBeNull();
    expect(prev!.sessionId).toBe('s2');
  });
});
