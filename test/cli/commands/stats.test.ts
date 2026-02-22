/**
 * Tests for the stats and health CLI command handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/storage/chunk-store.js', () => ({
  getChunkCount: vi.fn(),
  getSessionIds: vi.fn(),
}));

vi.mock('../../../src/storage/edge-store.js', () => ({
  getEdgeCount: vi.fn(),
}));

vi.mock('../../../src/storage/cluster-store.js', () => ({
  getClusterCount: vi.fn(),
}));

vi.mock('../../../src/hooks/hook-status.js', () => ({
  readHookStatus: vi.fn(),
  formatHookStatus: vi.fn(),
}));

import { statsCommand, healthCommand } from '../../../src/cli/commands/stats.js';
import { getChunkCount, getSessionIds } from '../../../src/storage/chunk-store.js';
import { getEdgeCount } from '../../../src/storage/edge-store.js';
import { getClusterCount } from '../../../src/storage/cluster-store.js';
import { readHookStatus, formatHookStatus } from '../../../src/hooks/hook-status.js';

const mockGetChunkCount = vi.mocked(getChunkCount);
const mockGetSessionIds = vi.mocked(getSessionIds);
const mockGetEdgeCount = vi.mocked(getEdgeCount);
const mockGetClusterCount = vi.mocked(getClusterCount);
const mockReadHookStatus = vi.mocked(readHookStatus);
const mockFormatHookStatus = vi.mocked(formatHookStatus);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('statsCommand', () => {
  it('has correct name and description', () => {
    expect(statsCommand.name).toBe('stats');
    expect(statsCommand.description).toContain('statistics');
  });

  it('prints memory statistics', async () => {
    mockGetChunkCount.mockReturnValue(100);
    mockGetSessionIds.mockReturnValue(['s1', 's2', 's3']);
    mockGetEdgeCount.mockReturnValue(250);
    mockGetClusterCount.mockReturnValue(5);
    mockReadHookStatus.mockReturnValue({} as ReturnType<typeof readHookStatus>);
    mockFormatHookStatus.mockReturnValue('Hook status: OK');

    await statsCommand.handler([]);

    expect(console.log).toHaveBeenCalledWith('Memory Statistics:');
    expect(console.log).toHaveBeenCalledWith('  Sessions: 3');
    expect(console.log).toHaveBeenCalledWith('  Chunks: 100');
    expect(console.log).toHaveBeenCalledWith('  Edges: 250');
    expect(console.log).toHaveBeenCalledWith('  Clusters: 5');
    expect(console.log).toHaveBeenCalledWith('Hook status: OK');
  });

  it('handles zero counts', async () => {
    mockGetChunkCount.mockReturnValue(0);
    mockGetSessionIds.mockReturnValue([]);
    mockGetEdgeCount.mockReturnValue(0);
    mockGetClusterCount.mockReturnValue(0);
    mockReadHookStatus.mockReturnValue({} as ReturnType<typeof readHookStatus>);
    mockFormatHookStatus.mockReturnValue('');

    await statsCommand.handler([]);

    expect(console.log).toHaveBeenCalledWith('  Sessions: 0');
    expect(console.log).toHaveBeenCalledWith('  Chunks: 0');
  });
});

describe('healthCommand', () => {
  it('has correct name and description', () => {
    expect(healthCommand.name).toBe('health');
    expect(healthCommand.description).toContain('health');
  });

  it('reports OK when database and vector store are healthy', async () => {
    vi.doMock('../../../src/storage/db.js', () => ({
      getDb: () => ({ prepare: () => ({ get: vi.fn() }) }),
    }));
    vi.doMock('../../../src/storage/vector-store.js', () => ({
      vectorStore: { count: vi.fn().mockResolvedValue(10) },
    }));

    await healthCommand.handler([]);

    expect(console.log).toHaveBeenCalledWith('Health Check:');
    expect(console.log).toHaveBeenCalledWith('System ready.');
  });
});
