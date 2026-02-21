/**
 * Tests for pre-compact hook handler.
 * Since pre-compact.ts now delegates to handleIngestionHook(),
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

import { handlePreCompact } from '../../src/hooks/pre-compact.js';
import { handleIngestionHook } from '../../src/hooks/hook-utils.js';

const mockHandleIngestionHook = vi.mocked(handleIngestionHook);

describe('pre-compact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePreCompact', () => {
    it('delegates to handleIngestionHook with "pre-compact" hook name', async () => {
      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'sess-123',
        chunkCount: 5,
        edgeCount: 3,
        clustersAssigned: 2,
        durationMs: 50,
        skipped: false,
      });

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(mockHandleIngestionHook).toHaveBeenCalledWith(
        'pre-compact',
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
      await handlePreCompact('/path/to/session.jsonl', options);

      expect(mockHandleIngestionHook).toHaveBeenCalledWith(
        'pre-compact',
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

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.skipped).toBe(true);
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

      const result = await handlePreCompact('/path/to/session.jsonl');

      expect(result.degraded).toBe(true);
    });
  });

  describe('preCompactCli exit codes', () => {
    it('degraded mode exits with code 0', async () => {
      // Import dynamically to test CLI behavior
      const { preCompactCli } = await import('../../src/hooks/pre-compact.js');

      mockHandleIngestionHook.mockResolvedValue({
        sessionId: 'degraded-session',
        chunkCount: 3,
        edgeCount: 1,
        clustersAssigned: 0,
        durationMs: 50,
        skipped: false,
        degraded: true,
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await preCompactCli('/path/to/session.jsonl');

      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it('total failure exits with code 1', async () => {
      const { preCompactCli } = await import('../../src/hooks/pre-compact.js');

      mockHandleIngestionHook.mockRejectedValue(new Error('Database corrupt'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await preCompactCli('/path/to/session.jsonl');

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });
});
