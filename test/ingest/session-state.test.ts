/**
 * Tests for session state extraction from transcripts.
 */

import { describe, it, expect } from 'vitest';
import { extractSessionState } from '../../src/ingest/session-state.js';
import type { Turn, ToolExchange, ContentBlock } from '../../src/parser/types.js';

/** Helper to build a minimal turn with tool exchanges. */
function makeTurn(exchanges: Partial<ToolExchange>[], assistantBlocks: ContentBlock[] = []): Turn {
  return {
    index: 0,
    startTime: '2025-01-01T00:00:00Z',
    userText: 'test',
    assistantBlocks,
    toolExchanges: exchanges.map((e) => ({
      toolName: e.toolName ?? 'Unknown',
      toolUseId: e.toolUseId ?? 'tu-1',
      input: e.input ?? {},
      result: e.result ?? '',
      isError: e.isError ?? false,
    })),
    hasThinking: false,
    rawMessages: [],
  };
}

describe('extractSessionState', () => {
  describe('file extraction', () => {
    it('extracts file paths from Read tool', () => {
      const turns = [
        makeTurn([{ toolName: 'Read', input: { file_path: '/src/foo.ts' }, result: 'content' }]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toContain('/src/foo.ts');
    });

    it('extracts file paths from Write tool', () => {
      const turns = [
        makeTurn([{ toolName: 'Write', input: { file_path: '/src/bar.ts' }, result: 'ok' }]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toContain('/src/bar.ts');
    });

    it('extracts file paths from Edit tool', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Edit',
            input: { file_path: '/src/baz.ts', old_string: 'a', new_string: 'b' },
            result: 'ok',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toContain('/src/baz.ts');
    });

    it('extracts directory path from Glob tool', () => {
      const turns = [
        makeTurn([{ toolName: 'Glob', input: { pattern: '*.ts', path: '/src' }, result: 'files' }]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toContain('/src');
    });

    it('deduplicates file paths', () => {
      const turns = [
        makeTurn([
          { toolName: 'Read', input: { file_path: '/src/foo.ts' }, result: 'content' },
          { toolName: 'Edit', input: { file_path: '/src/foo.ts' }, result: 'ok' },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched.filter((f) => f === '/src/foo.ts')).toHaveLength(1);
    });

    it('sorts file paths', () => {
      const turns = [
        makeTurn([
          { toolName: 'Read', input: { file_path: '/src/z.ts' }, result: 'a' },
          { toolName: 'Read', input: { file_path: '/src/a.ts' }, result: 'b' },
          { toolName: 'Read', input: { file_path: '/src/m.ts' }, result: 'c' },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toEqual(['/src/a.ts', '/src/m.ts', '/src/z.ts']);
    });

    it('ignores non-file tools', () => {
      const turns = [
        makeTurn([
          { toolName: 'Bash', input: { command: 'ls' }, result: 'output' },
          { toolName: 'Grep', input: { pattern: 'foo' }, result: 'matches' },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.filesTouched).toHaveLength(0);
    });
  });

  describe('error extraction', () => {
    it('extracts errors from failed tool results', () => {
      const turns = [
        makeTurn(
          [
            {
              toolName: 'Bash',
              input: { command: 'npm test' },
              result: 'Error: test failed',
              isError: true,
            },
          ],
          [{ type: 'text', text: 'Let me fix the test.' }],
        ),
      ];
      const state = extractSessionState(turns);
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].tool).toBe('Bash');
      expect(state.errors[0].message).toBe('Error: test failed');
      expect(state.errors[0].resolution).toBe('Let me fix the test.');
    });

    it('truncates long error messages', () => {
      const longMessage = 'x'.repeat(300);
      const turns = [
        makeTurn([{ toolName: 'Read', input: {}, result: longMessage, isError: true }]),
      ];
      const state = extractSessionState(turns);
      expect(state.errors[0].message.length).toBeLessThanOrEqual(203); // 200 + '...'
    });

    it('ignores successful tool results', () => {
      const turns = [
        makeTurn([
          { toolName: 'Bash', input: { command: 'echo ok' }, result: 'ok', isError: false },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.errors).toHaveLength(0);
    });
  });

  describe('outcome extraction', () => {
    it('detects git commit', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Bash',
            input: { command: 'git commit -m "fix: bug"' },
            result: '[main abc1234]',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toContain('git commit');
    });

    it('detects git push', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Bash',
            input: { command: 'git push origin feat/branch' },
            result: 'pushed',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toContain('git push');
    });

    it('detects gh pr create', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Bash',
            input: { command: 'gh pr create --title "My PR"' },
            result: 'https://github.com/org/repo/pull/1',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toContain('gh pr create');
    });

    it('detects gh pr merge', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Bash',
            input: { command: 'gh pr merge 42 --squash' },
            result: 'merged',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toContain('gh pr merge');
    });

    it('detects npm publish', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'Bash',
            input: { command: 'npm publish --access public' },
            result: 'published',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toContain('npm publish');
    });

    it('deduplicates outcomes', () => {
      const turns = [
        makeTurn([
          { toolName: 'Bash', input: { command: 'git commit -m "a"' }, result: 'ok' },
          { toolName: 'Bash', input: { command: 'git commit -m "b"' }, result: 'ok' },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes.filter((o) => o === 'git commit')).toHaveLength(1);
    });

    it('ignores non-Bash tools', () => {
      const turns = [
        makeTurn([{ toolName: 'Read', input: { file_path: '/a' }, result: 'git commit' }]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toHaveLength(0);
    });

    it('ignores Bash commands without outcome patterns', () => {
      const turns = [
        makeTurn([{ toolName: 'Bash', input: { command: 'npm test' }, result: 'passed' }]),
      ];
      const state = extractSessionState(turns);
      expect(state.outcomes).toHaveLength(0);
    });
  });

  describe('task extraction', () => {
    it('extracts tasks from TaskCreate', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'TaskCreate',
            toolUseId: 'task-1',
            input: { subject: 'Fix the auth bug' },
            result: 'created',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].description).toBe('Fix the auth bug');
      expect(state.tasks[0].status).toBe('pending');
    });

    it('updates tasks from TaskUpdate', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'TaskCreate',
            toolUseId: 'task-1',
            input: { subject: 'Fix auth' },
            result: 'created',
          },
          {
            toolName: 'TaskUpdate',
            toolUseId: 'tu-update',
            input: { taskId: 'task-1', status: 'completed' },
            result: 'updated',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].status).toBe('completed');
    });

    it('handles TaskUpdate without prior TaskCreate', () => {
      const turns = [
        makeTurn([
          {
            toolName: 'TaskUpdate',
            toolUseId: 'tu-1',
            input: { taskId: 'orphan-task', status: 'in_progress', subject: 'New task' },
            result: 'ok',
          },
        ]),
      ];
      const state = extractSessionState(turns);
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].description).toBe('New task');
      expect(state.tasks[0].status).toBe('in_progress');
    });
  });

  describe('combined extraction', () => {
    it('extracts all state types from a realistic session', () => {
      const turns = [
        makeTurn([
          { toolName: 'Read', input: { file_path: '/src/auth.ts' }, result: 'code' },
          { toolName: 'Read', input: { file_path: '/src/login.ts' }, result: 'code' },
        ]),
        makeTurn(
          [
            {
              toolName: 'Bash',
              input: { command: 'npm test' },
              result: 'FAIL: auth.test.ts',
              isError: true,
            },
          ],
          [{ type: 'text', text: 'The test is failing because of a missing import.' }],
        ),
        makeTurn([
          {
            toolName: 'Edit',
            input: { file_path: '/src/auth.ts', old_string: 'a', new_string: 'b' },
            result: 'ok',
          },
          {
            toolName: 'Bash',
            input: { command: 'git commit -m "fix: auth import"' },
            result: '[feat abc1234]',
          },
        ]),
      ];

      const state = extractSessionState(turns);

      // Files
      expect(state.filesTouched).toContain('/src/auth.ts');
      expect(state.filesTouched).toContain('/src/login.ts');

      // Errors
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].tool).toBe('Bash');

      // Outcomes
      expect(state.outcomes).toContain('git commit');

      // No tasks in this session
      expect(state.tasks).toHaveLength(0);
    });

    it('returns empty state for empty turns', () => {
      const state = extractSessionState([]);
      expect(state.filesTouched).toHaveLength(0);
      expect(state.errors).toHaveLength(0);
      expect(state.outcomes).toHaveLength(0);
      expect(state.tasks).toHaveLength(0);
    });
  });
});
