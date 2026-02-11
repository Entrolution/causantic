/**
 * Tests for audit log functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../src/config/memory-config.js', () => ({
  resolvePath: vi.fn((p: string) => p.replace('~', '/home/test')),
}));

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../../src/config/loader.js';
import { logAudit, readAuditLog, formatAuditEntries } from '../../src/storage/audit-log.js';
import type { AuditEntry } from '../../src/storage/audit-log.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('logAudit', () => {
  it('does nothing when auditLog is disabled', () => {
    vi.mocked(loadConfig).mockReturnValue({} as any);

    logAudit('open', 'test');

    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when encryption config is missing', () => {
    vi.mocked(loadConfig).mockReturnValue({} as any);

    logAudit('open');

    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('appends JSON entry when auditLog is enabled', () => {
    vi.mocked(loadConfig).mockReturnValue({
      encryption: { auditLog: true },
    } as any);

    logAudit('open', 'opened database');

    expect(appendFileSync).toHaveBeenCalledOnce();
    const [path, content] = vi.mocked(appendFileSync).mock.calls[0];
    expect(path).toContain('audit.log');

    const entry = JSON.parse((content as string).trim());
    expect(entry.action).toBe('open');
    expect(entry.details).toBe('opened database');
    expect(entry.timestamp).toBeDefined();
    expect(entry.pid).toBe(process.pid);
  });

  it('silently fails if appendFileSync throws', () => {
    vi.mocked(loadConfig).mockReturnValue({
      encryption: { auditLog: true },
    } as any);
    vi.mocked(appendFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => logAudit('open')).not.toThrow();
  });
});

describe('readAuditLog', () => {
  it('returns empty array if file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(readAuditLog()).toEqual([]);
  });

  it('reads and parses JSON lines', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const entries = [
      { timestamp: '2024-01-01T00:00:00Z', action: 'open', pid: 1 },
      { timestamp: '2024-01-01T00:01:00Z', action: 'close', pid: 1 },
    ];
    vi.mocked(readFileSync).mockReturnValue(
      entries.map((e) => JSON.stringify(e)).join('\n') as any
    );

    const result = readAuditLog();

    expect(result).toHaveLength(2);
    expect(result[0].action).toBe('open');
    expect(result[1].action).toBe('close');
  });

  it('returns last N entries', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const entries = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      action: 'query',
      pid: 1,
    }));
    vi.mocked(readFileSync).mockReturnValue(
      entries.map((e) => JSON.stringify(e)).join('\n') as any
    );

    const result = readAuditLog(5);

    expect(result).toHaveLength(5);
    expect(result[0].timestamp).toContain('00:15:00');
  });

  it('uses default limit of 10', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const entries = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      action: 'query',
      pid: 1,
    }));
    vi.mocked(readFileSync).mockReturnValue(
      entries.map((e) => JSON.stringify(e)).join('\n') as any
    );

    const result = readAuditLog();

    expect(result).toHaveLength(10);
  });

  it('filters empty lines', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '{"timestamp":"t","action":"open","pid":1}\n\n\n{"timestamp":"t","action":"close","pid":1}\n' as any
    );

    const result = readAuditLog();

    expect(result).toHaveLength(2);
  });

  it('returns empty array on parse error', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json' as any);

    expect(readAuditLog()).toEqual([]);
  });
});

describe('formatAuditEntries', () => {
  it('returns message for empty array', () => {
    expect(formatAuditEntries([])).toBe('No audit entries found.');
  });

  it('formats entries with padded action', () => {
    const entries: AuditEntry[] = [
      { timestamp: '2024-01-01T00:00:00Z', action: 'open', details: 'db opened', pid: 1 },
    ];

    const result = formatAuditEntries(entries);

    expect(result).toContain('2024-01-01T00:00:00Z');
    expect(result).toContain('open');
    expect(result).toContain('db opened');
  });

  it('handles entries without details', () => {
    const entries: AuditEntry[] = [
      { timestamp: '2024-01-01T00:00:00Z', action: 'close', pid: 1 },
    ];

    const result = formatAuditEntries(entries);

    expect(result).toContain('close');
  });

  it('joins multiple entries with newlines', () => {
    const entries: AuditEntry[] = [
      { timestamp: '2024-01-01T00:00:00Z', action: 'open', pid: 1 },
      { timestamp: '2024-01-01T00:01:00Z', action: 'close', pid: 1 },
    ];

    const result = formatAuditEntries(entries);
    const lines = result.split('\n');

    expect(lines).toHaveLength(2);
  });
});
