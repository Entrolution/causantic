/**
 * Tests for session state store CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, setupTestDb, teardownTestDb } from './test-utils.js';
import {
  upsertSessionState,
  getSessionState,
  getRecentSessionStates,
  getSessionStatesByTimeRange,
  deleteSessionState,
  deleteSessionStatesForProject,
  countSessionStates,
} from '../../src/storage/session-state-store.js';
import type { SessionState } from '../../src/ingest/session-state.js';

let db: Database.Database;

const sampleState: SessionState = {
  filesTouched: ['/src/auth.ts', '/src/login.ts'],
  errors: [{ tool: 'Bash', message: 'test failed' }],
  outcomes: ['git commit'],
  tasks: [{ description: 'Fix auth bug', status: 'completed' }],
};

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

describe('upsertSessionState', () => {
  it('inserts a new session state', () => {
    upsertSessionState('sess-1', 'my-project', '/path/to/project', '2025-01-01T12:00:00Z', sampleState);

    const stored = getSessionState('sess-1');
    expect(stored).not.toBeNull();
    expect(stored!.sessionId).toBe('sess-1');
    expect(stored!.sessionSlug).toBe('my-project');
    expect(stored!.projectPath).toBe('/path/to/project');
    expect(stored!.endedAt).toBe('2025-01-01T12:00:00Z');
    expect(stored!.filesTouched).toEqual(['/src/auth.ts', '/src/login.ts']);
    expect(stored!.errors).toHaveLength(1);
    expect(stored!.errors[0].tool).toBe('Bash');
    expect(stored!.outcomes).toEqual(['git commit']);
    expect(stored!.tasks).toHaveLength(1);
    expect(stored!.tasks[0].description).toBe('Fix auth bug');
    expect(stored!.summary).toBeNull();
  });

  it('upserts with summary', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState, 'Fixed auth bug and committed.');

    const stored = getSessionState('sess-1');
    expect(stored!.summary).toBe('Fixed auth bug and committed.');
  });

  it('replaces existing session state', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const updatedState: SessionState = {
      filesTouched: ['/src/new.ts'],
      errors: [],
      outcomes: ['git push'],
      tasks: [],
    };
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T13:00:00Z', updatedState);

    const stored = getSessionState('sess-1');
    expect(stored!.filesTouched).toEqual(['/src/new.ts']);
    expect(stored!.outcomes).toEqual(['git push']);
    expect(stored!.endedAt).toBe('2025-01-01T13:00:00Z');
  });
});

describe('getSessionState', () => {
  it('returns null for non-existent session', () => {
    const stored = getSessionState('non-existent');
    expect(stored).toBeNull();
  });
});

describe('getRecentSessionStates', () => {
  it('returns recent states ordered by ended_at desc', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T12:00:00Z', sampleState);
    upsertSessionState('sess-3', 'proj', null, '2025-01-01T11:00:00Z', sampleState);

    const recent = getRecentSessionStates('proj', 3);
    expect(recent).toHaveLength(3);
    // Should be newest first
    expect(recent[0].sessionId).toBe('sess-2');
    expect(recent[1].sessionId).toBe('sess-3');
    expect(recent[2].sessionId).toBe('sess-1');
  });

  it('respects limit', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T11:00:00Z', sampleState);
    upsertSessionState('sess-3', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const recent = getRecentSessionStates('proj', 2);
    expect(recent).toHaveLength(2);
  });

  it('filters by project', () => {
    upsertSessionState('sess-1', 'proj-a', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj-b', null, '2025-01-01T11:00:00Z', sampleState);

    const recent = getRecentSessionStates('proj-a');
    expect(recent).toHaveLength(1);
    expect(recent[0].sessionId).toBe('sess-1');
  });
});

describe('getSessionStatesByTimeRange', () => {
  it('returns states within time range', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T12:00:00Z', sampleState);
    upsertSessionState('sess-3', 'proj', null, '2025-01-01T14:00:00Z', sampleState);

    const states = getSessionStatesByTimeRange('proj', '2025-01-01T11:00:00Z', '2025-01-01T13:00:00Z');
    expect(states).toHaveLength(1);
    expect(states[0].sessionId).toBe('sess-2');
  });
});

describe('deleteSessionState', () => {
  it('deletes a session state', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    expect(deleteSessionState('sess-1')).toBe(true);
    expect(getSessionState('sess-1')).toBeNull();
  });

  it('returns false for non-existent session', () => {
    expect(deleteSessionState('non-existent')).toBe(false);
  });
});

describe('deleteSessionStatesForProject', () => {
  it('deletes all session states for a project', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T11:00:00Z', sampleState);
    upsertSessionState('sess-3', 'other', null, '2025-01-01T12:00:00Z', sampleState);

    const deleted = deleteSessionStatesForProject('proj');
    expect(deleted).toBe(2);
    expect(countSessionStates('proj')).toBe(0);
    expect(countSessionStates('other')).toBe(1);
  });
});

describe('countSessionStates', () => {
  it('counts all session states', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T11:00:00Z', sampleState);

    expect(countSessionStates()).toBe(2);
  });

  it('counts by project', () => {
    upsertSessionState('sess-1', 'proj-a', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj-b', null, '2025-01-01T11:00:00Z', sampleState);

    expect(countSessionStates('proj-a')).toBe(1);
    expect(countSessionStates('proj-b')).toBe(1);
  });
});
