/**
 * Tests for maintenance task handlers.
 *
 * Each task accepts its dependencies as parameters, so we can inject
 * mocks/stubs directly without needing a real database or file system.
 */

import { describe, it, expect, vi } from 'vitest';
import { scanProjects } from '../../src/maintenance/tasks/scan-projects.js';
import { updateClusters } from '../../src/maintenance/tasks/update-clusters.js';
import { pruneGraph } from '../../src/maintenance/tasks/prune-graph.js';
import { refreshLabels } from '../../src/maintenance/tasks/refresh-labels.js';
import { vacuum } from '../../src/maintenance/tasks/vacuum.js';
import { cleanupVectors } from '../../src/maintenance/tasks/cleanup-vectors.js';

describe('scanProjects', () => {
  it('returns success when projects directory does not exist', async () => {
    const result = await scanProjects({
      batchIngest: vi.fn(),
      claudeProjectsPath: '/nonexistent/path',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('No Claude projects directory found');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('returns success with session count after ingestion', async () => {
    const batchIngest = vi.fn().mockResolvedValue({ successCount: 5 });

    // Use a path that exists (the test directory itself)
    const result = await scanProjects({
      batchIngest,
      claudeProjectsPath: process.cwd(),
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('5 sessions processed');
    expect(batchIngest).toHaveBeenCalledWith([process.cwd()], {});
  });

  it('returns failure when batchIngest throws', async () => {
    const batchIngest = vi.fn().mockRejectedValue(new Error('disk full'));

    const result = await scanProjects({
      batchIngest,
      claudeProjectsPath: process.cwd(),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('disk full');
  });
});

describe('updateClusters', () => {
  it('returns success when recluster succeeds', async () => {
    const recluster = vi.fn().mockResolvedValue(undefined);

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Clusters updated successfully');
    expect(recluster).toHaveBeenCalledOnce();
  });

  it('returns failure when recluster throws', async () => {
    const recluster = vi.fn().mockRejectedValue(new Error('no embeddings'));

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(false);
    expect(result.message).toContain('no embeddings');
  });
});

describe('pruneGraph', () => {
  it('returns success with deletion counts', async () => {
    const flushNow = vi.fn().mockResolvedValue({ edgesDeleted: 3, chunksDeleted: 1 });

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Pruned 3 edges, 1 chunks');
    expect(result.details).toBeDefined();
  });

  it('returns failure when flush throws', async () => {
    const flushNow = vi.fn().mockRejectedValue(new Error('db locked'));

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(false);
    expect(result.message).toContain('db locked');
  });

  it('handles zero deletions', async () => {
    const flushNow = vi.fn().mockResolvedValue({ edgesDeleted: 0, chunksDeleted: 0 });

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Pruned 0 edges, 0 chunks');
  });
});

describe('refreshLabels', () => {
  it('returns success with refresh count', async () => {
    const refreshAllClusters = vi.fn().mockResolvedValue([{}, {}, {}]);

    const result = await refreshLabels({ refreshAllClusters });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Refreshed 3 cluster labels');
    expect(refreshAllClusters).toHaveBeenCalledWith({});
  });

  it('returns skipped message when API key is missing', async () => {
    const refreshAllClusters = vi.fn().mockRejectedValue(new Error('No API key configured'));

    const result = await refreshLabels({ refreshAllClusters });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Skipped: No Anthropic API key configured');
  });

  it('returns failure for non-API-key errors', async () => {
    const refreshAllClusters = vi.fn().mockRejectedValue(new Error('rate limited'));

    const result = await refreshLabels({ refreshAllClusters });

    expect(result.success).toBe(false);
    expect(result.message).toContain('rate limited');
  });

  it('handles empty cluster list', async () => {
    const refreshAllClusters = vi.fn().mockResolvedValue([]);

    const result = await refreshLabels({ refreshAllClusters });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Refreshed 0 cluster labels');
  });
});

describe('vacuum', () => {
  it('returns success when vacuum completes', async () => {
    const mockDb = { exec: vi.fn() } as any;
    const getDb = vi.fn().mockReturnValue(mockDb);

    const result = await vacuum({ getDb });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Database vacuumed successfully');
    expect(mockDb.exec).toHaveBeenCalledWith('VACUUM');
  });

  it('returns failure when vacuum throws', async () => {
    const mockDb = {
      exec: vi.fn().mockImplementation(() => {
        throw new Error('database is locked');
      }),
    } as any;
    const getDb = vi.fn().mockReturnValue(mockDb);

    const result = await vacuum({ getDb });

    expect(result.success).toBe(false);
    expect(result.message).toContain('database is locked');
  });

  it('returns failure when getDb throws', async () => {
    const getDb = vi.fn().mockImplementation(() => {
      throw new Error('no encryption key');
    });

    const result = await vacuum({ getDb });

    expect(result.success).toBe(false);
    expect(result.message).toContain('no encryption key');
  });
});

describe('cleanupVectors', () => {
  it('returns success with deletion count', async () => {
    const cleanupExpired = vi.fn().mockResolvedValue(10);

    const result = await cleanupVectors({ cleanupExpired, ttlDays: 90 });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Cleaned up 10 expired orphaned vectors');
    expect(result.details).toEqual({ deletedCount: 10, ttlDays: 90 });
    expect(cleanupExpired).toHaveBeenCalledWith(90);
  });

  it('returns failure when cleanup throws', async () => {
    const cleanupExpired = vi.fn().mockRejectedValue(new Error('vector store unavailable'));

    const result = await cleanupVectors({ cleanupExpired, ttlDays: 30 });

    expect(result.success).toBe(false);
    expect(result.message).toContain('vector store unavailable');
  });

  it('handles zero deletions', async () => {
    const cleanupExpired = vi.fn().mockResolvedValue(0);

    const result = await cleanupVectors({ cleanupExpired, ttlDays: 90 });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Cleaned up 0 expired orphaned vectors');
  });

  it('passes correct TTL days to cleanup function', async () => {
    const cleanupExpired = vi.fn().mockResolvedValue(0);

    await cleanupVectors({ cleanupExpired, ttlDays: 45 });

    expect(cleanupExpired).toHaveBeenCalledWith(45);
  });
});
