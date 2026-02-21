/**
 * Tests for the hook CLI command handler.
 *
 * Note: readStdin() returns {} in test context because process.stdin.isTTY is truthy.
 * We test hook dispatch via args instead of stdin input.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all hook handlers before importing the command
vi.mock('../../../src/hooks/session-start.js', () => ({
  handleSessionStart: vi.fn(),
}));

vi.mock('../../../src/hooks/pre-compact.js', () => ({
  handlePreCompact: vi.fn(),
}));

vi.mock('../../../src/hooks/session-end.js', () => ({
  handleSessionEnd: vi.fn(),
}));

vi.mock('../../../src/hooks/claudemd-generator.js', () => ({
  updateClaudeMd: vi.fn(),
}));

import { hookCommand } from '../../../src/cli/commands/hook.js';
import { handleSessionStart } from '../../../src/hooks/session-start.js';
import { handlePreCompact } from '../../../src/hooks/pre-compact.js';
import { handleSessionEnd } from '../../../src/hooks/session-end.js';
import { updateClaudeMd } from '../../../src/hooks/claudemd-generator.js';

const mockHandleSessionStart = vi.mocked(handleSessionStart);
const mockHandlePreCompact = vi.mocked(handlePreCompact);
const mockHandleSessionEnd = vi.mocked(handleSessionEnd);
const mockUpdateClaudeMd = vi.mocked(updateClaudeMd);

// readStdin() adds data/end/error listeners to process.stdin on each call.
// Since process.stdin is a singleton, listeners accumulate across tests.
// Raise the limit to avoid MaxListenersExceeded warnings (12 tests × 3 listeners).
const originalMaxListeners = process.stdin.getMaxListeners();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  process.stdin.setMaxListeners(50);
});

afterEach(() => {
  process.stdin.setMaxListeners(originalMaxListeners);
});

describe('hookCommand', () => {
  it('has correct name and usage', () => {
    expect(hookCommand.name).toBe('hook');
    expect(hookCommand.usage).toContain('session-start');
    expect(hookCommand.usage).toContain('pre-compact');
    expect(hookCommand.usage).toContain('session-end');
    expect(hookCommand.usage).toContain('claudemd-generator');
  });

  describe('session-start', () => {
    it('calls handleSessionStart with basename of arg path', async () => {
      mockHandleSessionStart.mockResolvedValue({
        summary: 'Test summary',
        recentChunks: [],
        predictions: [],
      });

      await hookCommand.handler(['session-start', '/projects/my-app']);

      expect(mockHandleSessionStart).toHaveBeenCalledWith('my-app', {});
    });

    it('outputs structured JSON for Claude Code hook system', async () => {
      mockHandleSessionStart.mockResolvedValue({
        summary: 'Memory context here',
        recentChunks: [],
        predictions: [],
      });

      await hookCommand.handler(['session-start', '/projects/my-app']);

      const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const jsonCall = logCalls.find((c: string[]) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(output.hookSpecificOutput.additionalContext).toContain('Memory context here');
    });

    it('falls back to process.cwd basename when no arg provided', async () => {
      mockHandleSessionStart.mockResolvedValue({
        summary: '',
        recentChunks: [],
        predictions: [],
      });

      await hookCommand.handler(['session-start']);

      // Should use basename of cwd as project slug
      expect(mockHandleSessionStart).toHaveBeenCalledWith(expect.any(String), {});
    });
  });

  describe('pre-compact', () => {
    it('calls handlePreCompact with arg path', async () => {
      mockHandlePreCompact.mockResolvedValue(undefined);

      await hookCommand.handler(['pre-compact', '/tmp/session.jsonl']);

      expect(mockHandlePreCompact).toHaveBeenCalledWith('/tmp/session.jsonl', {
        project: expect.any(String),
        sessionId: undefined,
      });
      expect(console.log).toHaveBeenCalledWith('Pre-compact hook executed.');
    });

    it('exits with code 2 when no path provided', async () => {
      await hookCommand.handler(['pre-compact']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: No transcript_path in stdin and no path argument provided.',
      );
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('session-end', () => {
    it('calls handleSessionEnd with arg path', async () => {
      mockHandleSessionEnd.mockResolvedValue(undefined);

      await hookCommand.handler(['session-end', '/tmp/session.jsonl']);

      expect(mockHandleSessionEnd).toHaveBeenCalledWith('/tmp/session.jsonl', {
        project: expect.any(String),
        sessionId: undefined,
      });
      expect(console.log).toHaveBeenCalledWith('Session-end hook executed.');
    });

    it('exits with code 2 when no path provided', async () => {
      await hookCommand.handler(['session-end']);

      expect(console.error).toHaveBeenCalledWith(
        'Error: No transcript_path in stdin and no path argument provided.',
      );
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('claudemd-generator', () => {
    it('calls updateClaudeMd with arg path', async () => {
      mockUpdateClaudeMd.mockResolvedValue(undefined);

      await hookCommand.handler(['claudemd-generator', '/projects/my-app']);

      expect(mockUpdateClaudeMd).toHaveBeenCalledWith('/projects/my-app', {});
      expect(console.log).toHaveBeenCalledWith('CLAUDE.md updated.');
    });

    it('falls back to process.cwd when no arg provided', async () => {
      mockUpdateClaudeMd.mockResolvedValue(undefined);

      await hookCommand.handler(['claudemd-generator']);

      expect(mockUpdateClaudeMd).toHaveBeenCalledWith(expect.any(String), {});
    });
  });

  describe('unknown hook', () => {
    it('prints error and exits with code 2', async () => {
      await hookCommand.handler(['nonexistent']);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown hook');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('handles no hook name provided', async () => {
      await hookCommand.handler([]);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown hook');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });
});
