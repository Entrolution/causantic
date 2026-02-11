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
  it('returns success when recluster succeeds without label refresh', async () => {
    const recluster = vi.fn().mockResolvedValue(undefined);

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Clusters updated successfully');
    expect(recluster).toHaveBeenCalledOnce();
  });

  it('returns success with label count when refresh succeeds', async () => {
    const recluster = vi.fn().mockResolvedValue(undefined);
    const refreshLabels = vi.fn().mockResolvedValue([{}, {}, {}]);

    const result = await updateClusters({ recluster, refreshLabels });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Clusters updated, 3 labels refreshed');
    expect(refreshLabels).toHaveBeenCalledOnce();
  });

  it('succeeds even when label refresh fails', async () => {
    const recluster = vi.fn().mockResolvedValue(undefined);
    const refreshLabels = vi.fn().mockRejectedValue(new Error('No API key'));

    const result = await updateClusters({ recluster, refreshLabels });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Clusters updated successfully');
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
    const flushNow = vi.fn().mockResolvedValue({ edgesDeleted: 3, chunksOrphaned: 1 });

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Pruned 3 edges, marked 1 chunks for TTL cleanup');
    expect(result.details).toBeDefined();
  });

  it('returns failure when flush throws', async () => {
    const flushNow = vi.fn().mockRejectedValue(new Error('db locked'));

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(false);
    expect(result.message).toContain('db locked');
  });

  it('handles zero deletions', async () => {
    const flushNow = vi.fn().mockResolvedValue({ edgesDeleted: 0, chunksOrphaned: 0 });

    const result = await pruneGraph({ flushNow });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Pruned 0 edges, marked 0 chunks for TTL cleanup');
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
