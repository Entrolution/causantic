/**
 * Tests for hook status tracker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Mock os.homedir() so STATUS_FILE_PATH resolves to a temp directory
const TEST_HOME = vi.hoisted(() => {
  const { mkdirSync: mkSync } = require('node:fs');
  const { tmpdir: tmp } = require('node:os');
  const { join: pjoin } = require('node:path');
  const dir = pjoin(tmp(), 'causantic-hook-status-test-home');
  mkSync(dir, { recursive: true });
  return dir;
});

vi.mock('node:os', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('node:os');
  return {
    ...original,
    homedir: () => TEST_HOME,
  };
});

import {
  recordHookStatus,
  readHookStatus,
  formatHookStatus,
  formatHookStatusMcp,
  timeAgo,
  STATUS_FILE_PATH,
  type HookStatusMap,
} from '../../src/hooks/hook-status.js';

describe('hook-status', () => {
  beforeEach(() => {
    mkdirSync(dirname(STATUS_FILE_PATH), { recursive: true });
    try {
      rmSync(STATUS_FILE_PATH);
    } catch {
      // Ignore
    }
    try {
      rmSync(STATUS_FILE_PATH + '.tmp');
    } catch {
      // Ignore
    }
  });

  afterEach(() => {
    try {
      rmSync(STATUS_FILE_PATH);
    } catch {
      // Ignore
    }
    try {
      rmSync(STATUS_FILE_PATH + '.tmp');
    } catch {
      // Ignore
    }
  });

  it('STATUS_FILE_PATH uses mocked homedir', () => {
    expect(STATUS_FILE_PATH).toContain('causantic-hook-status-test-home');
    expect(STATUS_FILE_PATH).toContain('.causantic');
    expect(STATUS_FILE_PATH).toContain('hook-status.json');
  });

  describe('recordHookStatus', () => {
    it('writes correct JSON structure', () => {
      recordHookStatus('session-start', {
        lastRun: '2026-02-14T21:30:00.000Z',
        success: true,
        durationMs: 142,
        project: 'my-project',
        error: null,
      });

      const raw = readFileSync(STATUS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed['session-start']).toEqual({
        lastRun: '2026-02-14T21:30:00.000Z',
        success: true,
        durationMs: 142,
        project: 'my-project',
        error: null,
      });
    });

    it('merges with existing entries for different hooks', () => {
      recordHookStatus('session-start', {
        lastRun: '2026-02-14T21:00:00.000Z',
        success: true,
        durationMs: 100,
        project: 'project-a',
        error: null,
      });

      recordHookStatus('session-end', {
        lastRun: '2026-02-14T21:10:00.000Z',
        success: true,
        durationMs: 3200,
        project: 'project-b',
        error: null,
      });

      const status = readHookStatus();
      expect(Object.keys(status)).toHaveLength(2);
      expect(status['session-start']?.project).toBe('project-a');
      expect(status['session-end']?.project).toBe('project-b');
    });

    it('overwrites existing entry for same hook', () => {
      recordHookStatus('session-start', {
        lastRun: '2026-02-14T20:00:00.000Z',
        success: true,
        durationMs: 100,
        project: 'old-project',
        error: null,
      });

      recordHookStatus('session-start', {
        lastRun: '2026-02-14T21:00:00.000Z',
        success: false,
        durationMs: 50,
        project: 'new-project',
        error: 'something broke',
      });

      const status = readHookStatus();
      expect(status['session-start']?.lastRun).toBe('2026-02-14T21:00:00.000Z');
      expect(status['session-start']?.success).toBe(false);
      expect(status['session-start']?.error).toBe('something broke');
    });

    it('merges partial updates into existing entry', () => {
      recordHookStatus('session-end', {
        lastRun: '2026-02-14T21:00:00.000Z',
        success: true,
        durationMs: 3200,
        project: 'my-project',
        error: null,
      });

      // Enrich with details (partial update)
      recordHookStatus('session-end', {
        details: { chunks: 12, edges: 8 },
      });

      const status = readHookStatus();
      expect(status['session-end']?.success).toBe(true);
      expect(status['session-end']?.durationMs).toBe(3200);
      expect(status['session-end']?.details).toEqual({ chunks: 12, edges: 8 });
    });

    it('creates directory if it does not exist', () => {
      try {
        rmSync(dirname(STATUS_FILE_PATH), { recursive: true });
      } catch {
        // Ignore
      }

      recordHookStatus('test-hook', {
        lastRun: new Date().toISOString(),
        success: true,
        durationMs: 10,
        project: null,
        error: null,
      });

      const status = readHookStatus();
      expect(status['test-hook']).toBeTruthy();
    });

    it('records sessionId when provided', () => {
      recordHookStatus('session-end', {
        lastRun: '2026-02-14T21:30:00.000Z',
        success: true,
        durationMs: 3200,
        project: 'my-project',
        sessionId: 'abc-123-def-456',
        error: null,
      });

      const status = readHookStatus();
      expect(status['session-end']?.sessionId).toBe('abc-123-def-456');
    });

    it('omits sessionId when not provided', () => {
      recordHookStatus('session-start', {
        lastRun: '2026-02-14T21:30:00.000Z',
        success: true,
        durationMs: 142,
        project: 'my-project',
        error: null,
      });

      const status = readHookStatus();
      expect(status['session-start']?.sessionId).toBeUndefined();
    });

    it('records error message on failure', () => {
      recordHookStatus('pre-compact', {
        lastRun: '2026-02-14T19:00:00.000Z',
        success: false,
        durationMs: 50,
        project: 'my-project',
        error: 'database is locked',
      });

      const status = readHookStatus();
      expect(status['pre-compact']?.success).toBe(false);
      expect(status['pre-compact']?.error).toBe('database is locked');
    });
  });

  describe('readHookStatus', () => {
    it('returns empty object for missing file', () => {
      const status = readHookStatus();
      expect(status).toEqual({});
    });

    it('returns empty object for corrupt JSON', () => {
      writeFileSync(STATUS_FILE_PATH, 'not valid json{{{', 'utf-8');

      const status = readHookStatus();
      expect(status).toEqual({});
    });

    it('returns empty object for JSON array', () => {
      writeFileSync(STATUS_FILE_PATH, '["not", "an", "object"]', 'utf-8');

      const status = readHookStatus();
      expect(status).toEqual({});
    });

    it('returns empty object for JSON null', () => {
      writeFileSync(STATUS_FILE_PATH, 'null', 'utf-8');

      const status = readHookStatus();
      expect(status).toEqual({});
    });

    it('reads valid status file correctly', () => {
      const data: HookStatusMap = {
        'session-start': {
          lastRun: '2026-02-14T21:30:00.000Z',
          success: true,
          durationMs: 142,
          project: 'test-project',
          error: null,
        },
      };
      writeFileSync(STATUS_FILE_PATH, JSON.stringify(data), 'utf-8');

      const status = readHookStatus();
      expect(status['session-start']?.project).toBe('test-project');
      expect(status['session-start']?.durationMs).toBe(142);
    });
  });

  describe('timeAgo', () => {
    it('returns "just now" for very recent times', () => {
      const now = new Date().toISOString();
      expect(timeAgo(now)).toBe('just now');
    });

    it('returns minutes for times within the last hour', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(timeAgo(fiveMinAgo)).toBe('5 min ago');
    });

    it('returns hours for times within the last day', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(twoHoursAgo)).toBe('2 hours ago');
    });

    it('returns singular hour', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(oneHourAgo)).toBe('1 hour ago');
    });

    it('returns days for older times', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(threeDaysAgo)).toBe('3 days ago');
    });

    it('returns singular day', () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(oneDayAgo)).toBe('1 day ago');
    });

    it('returns "unknown" for invalid dates', () => {
      expect(timeAgo('not-a-date')).toBe('unknown');
    });

    it('returns "just now" for future times', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(timeAgo(future)).toBe('just now');
    });
  });

  describe('formatHookStatus', () => {
    it('returns "no hooks have run yet" for empty status', () => {
      const result = formatHookStatus({});
      expect(result).toBe('Hook Status: (no hooks have run yet)');
    });

    it('formats successful hook entry', () => {
      const status: HookStatusMap = {
        'session-start': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 142,
          project: 'my-project',
          error: null,
        },
      };

      const result = formatHookStatus(status);
      expect(result).toContain('Hook Status:');
      expect(result).toContain('session-start');
      expect(result).toContain('success');
      expect(result).toContain('142ms');
      expect(result).toContain('(my-project)');
      expect(result).toContain('No issues detected');
    });

    it('formats failed hook entry', () => {
      const status: HookStatusMap = {
        'pre-compact': {
          lastRun: new Date().toISOString(),
          success: false,
          durationMs: 50,
          project: 'my-project',
          error: 'database is locked',
        },
      };

      const result = formatHookStatus(status);
      expect(result).toContain('FAILED');
      expect(result).toContain('database is locked');
      expect(result).toContain('Some hooks have failures');
    });

    it('formats entry with details (chunks, edges)', () => {
      const status: HookStatusMap = {
        'session-end': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 3200,
          project: 'my-project',
          details: { chunks: 12, edges: 8 },
          error: null,
        },
      };

      const result = formatHookStatus(status);
      expect(result).toContain('12 chunks');
      expect(result).toContain('8 edges');
    });

    it('formats sessionId (truncated to 8 chars) when present', () => {
      const status: HookStatusMap = {
        'session-end': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 3200,
          project: 'my-project',
          sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
          error: null,
        },
      };

      const result = formatHookStatus(status);
      expect(result).toContain('[abcdef12]');
    });

    it('does not show sessionId bracket when absent', () => {
      const status: HookStatusMap = {
        'session-start': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 142,
          project: 'my-project',
          error: null,
        },
      };

      const result = formatHookStatus(status);
      expect(result).not.toContain('[');
    });

    it('formats duration in seconds for large values', () => {
      const status: HookStatusMap = {
        'session-end': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 3200,
          project: 'test',
          error: null,
        },
      };

      const result = formatHookStatus(status);
      expect(result).toContain('3.2s');
    });
  });

  describe('formatHookStatusMcp', () => {
    it('returns "no hooks have run yet" for empty status', () => {
      const result = formatHookStatusMcp({});
      expect(result).toBe('Hook Status: (no hooks have run yet)');
    });

    it('formats for MCP output with structured text', () => {
      const status: HookStatusMap = {
        'session-start': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 142,
          project: 'my-project',
          error: null,
        },
      };

      const result = formatHookStatusMcp(status);
      expect(result).toContain('Hook Status:');
      expect(result).toContain('- session-start: last ran');
      expect(result).toContain('for my-project');
      expect(result).toContain('No issues detected');
    });

    it('includes error details for failed hooks', () => {
      const status: HookStatusMap = {
        'pre-compact': {
          lastRun: new Date().toISOString(),
          success: false,
          durationMs: 50,
          project: 'test',
          error: 'database is locked',
        },
      };

      const result = formatHookStatusMcp(status);
      expect(result).toContain('FAILED');
      expect(result).toMatch(/— database is locked/);
    });

    it('includes sessionId in MCP format when present', () => {
      const status: HookStatusMap = {
        'session-end': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 3200,
          project: 'my-project',
          sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
          error: null,
        },
      };

      const result = formatHookStatusMcp(status);
      expect(result).toContain('session:abcdef12');
    });

    it('includes ingestion details', () => {
      const status: HookStatusMap = {
        'session-end': {
          lastRun: new Date().toISOString(),
          success: true,
          durationMs: 3200,
          project: 'test',
          details: { chunks: 12, edges: 8 },
          error: null,
        },
      };

      const result = formatHookStatusMcp(status);
      expect(result).toMatch(/— 12 chunks, 8 edges/);
    });
  });
});
