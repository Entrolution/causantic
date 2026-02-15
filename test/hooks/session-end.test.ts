/**
 * Tests for session-end hook handler.
 * Since session-end.ts now delegates to handleIngestionHook(),
 * these tests verify the delegation and CLI entry point behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/hook-utils.js', () => ({
  handleIngestionHook: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { handleSessionEnd } from '../../src/hooks/session-end.js';
import { handleIngestionHook } from '../../src/hooks/hook-utils.js';

const mockHandleIngestionHook = vi.mocked(handleIngestionHook);

describe('session-end', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleSessionEnd', () => {
    it('delegates to handleIngestionHook with "session-end" hook name', async () => {
      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'sess-123',
        chunkCount: 5,
        edgeCount: 3,
        clustersAssigned: 2,
        durationMs: 50,
        skipped: false,
      });

      const result = await handleSessionEnd('/path/to/session.jsonl');

      expect(mockHandleIngestionHook).toHaveBeenCalledWith(
        'session-end',
        '/path/to/session.jsonl',
        {},
      );
      expect(result.sessionId).toBe('sess-123');
      expect(result.chunkCount).toBe(5);
      expect(result.edgeCount).toBe(3);
    });

    it('passes options through to handleIngestionHook', async () => {
      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'sess-456',
        chunkCount: 0,
        edgeCount: 0,
        clustersAssigned: 0,
        durationMs: 0,
        skipped: true,
      });

      const options = { enableRetry: false, maxRetries: 1, project: 'my-proj' };
      await handleSessionEnd('/path/to/session.jsonl', options);

      expect(mockHandleIngestionHook).toHaveBeenCalledWith(
        'session-end',
        '/path/to/session.jsonl',
        options,
      );
    });

    it('returns skipped result', async () => {
      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'sess-789',
        chunkCount: 0,
        edgeCount: 0,
        clustersAssigned: 0,
        durationMs: 5,
        skipped: true,
      });

      const result = await handleSessionEnd('/path/to/session.jsonl');

      expect(result.skipped).toBe(true);
      expect(result.sessionId).toBe('sess-789');
    });

    it('returns degraded result', async () => {
      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'unknown',
        chunkCount: 0,
        edgeCount: 0,
        clustersAssigned: 0,
        durationMs: 0,
        skipped: false,
        degraded: true,
      });

      const result = await handleSessionEnd('/path/to/session.jsonl');

      expect(result.degraded).toBe(true);
    });
  });
});
