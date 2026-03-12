/**
 * Tests for session briefing mode in the session reconstructor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, setupTestDb, teardownTestDb } from '../storage/test-utils.js';
import { buildBriefing } from '../../src/retrieval/session-reconstructor.js';
import { upsertSessionState } from '../../src/storage/session-state-store.js';
import type { SessionState } from '../../src/ingest/session-state.js';

let db: Database.Database;

const sampleState: SessionState = {
  filesTouched: ['/src/auth.ts', '/src/login.ts', '/src/middleware.ts'],
  errors: [
    { tool: 'Bash', message: 'npm test failed: auth.test.ts', resolution: 'Fixed the import path.' },
  ],
  outcomes: ['git commit', 'git push'],
  tasks: [
    { description: 'Fix auth bug', status: 'completed' },
    { description: 'Add tests', status: 'pending' },
  ],
};

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

describe('buildBriefing', () => {
  it('returns empty message when no data exists', () => {
    const result = buildBriefing({ project: 'nonexistent' });
    expect(result.text).toContain('No session history');
    expect(result.sessionCount).toBe(0);
    expect(result.hasRepoMap).toBe(false);
  });

  it('includes session state in briefing', () => {
    upsertSessionState('sess-1', 'my-project', '/path', '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'my-project' });

    expect(result.sessionCount).toBe(1);
    expect(result.text).toContain('Session Briefing: my-project');
    expect(result.text).toContain('Recent Sessions');
    expect(result.text).toContain('sess-1');
  });

  it('includes files touched', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('/src/auth.ts');
    expect(result.text).toContain('/src/login.ts');
    expect(result.text).toContain('Files touched');
  });

  it('includes outcomes', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('git commit');
    expect(result.text).toContain('git push');
    expect(result.text).toContain('Outcomes');
  });

  it('includes errors with resolution', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('Errors');
    expect(result.text).toContain('Bash');
    expect(result.text).toContain('Fixed the import path');
  });

  it('includes tasks', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('Tasks');
    expect(result.text).toContain('Fix auth bug');
    expect(result.text).toContain('[x]');
    expect(result.text).toContain('[ ]');
  });

  it('includes summary when available', () => {
    upsertSessionState(
      'sess-1', 'proj', null, '2025-01-01T12:00:00Z',
      sampleState, 'Fixed the authentication bug in the login flow.',
    );

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('Fixed the authentication bug');
  });

  it('shows multiple sessions in chronological order', () => {
    upsertSessionState('sess-old', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-new', 'proj', null, '2025-01-01T14:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj', maxSessions: 5 });
    expect(result.sessionCount).toBe(2);

    // Old session should appear before new session
    const oldIdx = result.text.indexOf('sess-old');
    const newIdx = result.text.indexOf('sess-new');
    expect(oldIdx).toBeLessThan(newIdx);
  });

  it('respects maxSessions limit', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T10:00:00Z', sampleState);
    upsertSessionState('sess-2', 'proj', null, '2025-01-01T11:00:00Z', sampleState);
    upsertSessionState('sess-3', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj', maxSessions: 2 });
    expect(result.sessionCount).toBe(2);
  });

  it('includes repo map text when provided', () => {
    const repoMapText = 'src/auth.ts\n  class AuthService (5)\n  fn login (20)\n';

    const result = buildBriefing({
      project: 'proj',
      repoMapText,
      maxTokens: 4096,
    });

    expect(result.hasRepoMap).toBe(true);
    expect(result.text).toContain('Project Structure');
    expect(result.text).toContain('AuthService');
  });

  it('reports token count', () => {
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', sampleState);

    const result = buildBriefing({ project: 'proj' });
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('truncates file list when more than 10 files', () => {
    const manyFiles: SessionState = {
      ...sampleState,
      filesTouched: Array.from({ length: 15 }, (_, i) => `/src/file-${i}.ts`),
    };
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', manyFiles);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('...and 5 more');
  });

  it('truncates error list when more than 3 errors', () => {
    const manyErrors: SessionState = {
      ...sampleState,
      errors: Array.from({ length: 5 }, (_, i) => ({
        tool: 'Bash',
        message: `Error ${i}`,
      })),
    };
    upsertSessionState('sess-1', 'proj', null, '2025-01-01T12:00:00Z', manyErrors);

    const result = buildBriefing({ project: 'proj' });
    expect(result.text).toContain('...and 2 more');
  });
});
