/**
 * Tests for maintenance task handlers.
 *
 * Each task accepts its dependencies as parameters, so we can inject
 * mocks/stubs directly without needing a real database or file system.
 */

import { describe, it, expect, vi } from 'vitest';
import { scanProjects } from '../../src/maintenance/tasks/scan-projects.js';
import { updateClusters } from '../../src/maintenance/tasks/update-clusters.js';
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
  const mockClusteringResult = {
    numClusters: 5,
    assignedChunks: 150,
    noiseChunks: 20,
    noiseRatio: 0.117,
    clusterSizes: [45, 35, 30, 25, 15],
    reassignedNoise: 0,
    durationMs: 500,
  };

  it('returns success with stats when recluster succeeds without label refresh', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(true);
    expect(result.message).toBe('5 clusters, 150 assigned');
    expect(recluster).toHaveBeenCalledOnce();
  });

  it('returns success with label count when refresh succeeds', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const refreshLabels = vi.fn().mockResolvedValue([{}, {}, {}]);

    const result = await updateClusters({ recluster, refreshLabels });

    expect(result.success).toBe(true);
    expect(result.message).toBe('5 clusters, 150 assigned, 3 labels refreshed');
    expect(refreshLabels).toHaveBeenCalledOnce();
  });

  it('includes noise rescued count when reassignedNoise > 0', async () => {
    const recluster = vi.fn().mockResolvedValue({
      ...mockClusteringResult,
      reassignedNoise: 12,
    });

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(true);
    expect(result.message).toBe('5 clusters, 150 assigned, 12 noise points rescued');
  });

  it('includes both noise rescued and labels refreshed', async () => {
    const recluster = vi.fn().mockResolvedValue({
      ...mockClusteringResult,
      reassignedNoise: 8,
    });
    const refreshLabels = vi.fn().mockResolvedValue([{}, {}]);

    const result = await updateClusters({ recluster, refreshLabels });

    expect(result.success).toBe(true);
    expect(result.message).toBe(
      '5 clusters, 150 assigned, 8 noise points rescued, 2 labels refreshed',
    );
  });

  it('succeeds even when label refresh fails', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const refreshLabels = vi.fn().mockRejectedValue(new Error('No API key'));

    const result = await updateClusters({ recluster, refreshLabels });

    expect(result.success).toBe(true);
    expect(result.message).toBe('5 clusters, 150 assigned');
  });

  it('returns failure when recluster throws', async () => {
    const recluster = vi.fn().mockRejectedValue(new Error('no embeddings'));

    const result = await updateClusters({ recluster });

    expect(result.success).toBe(false);
    expect(result.message).toContain('no embeddings');
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
    const evictOldest = vi.fn().mockResolvedValue(0);

    const result = await cleanupVectors({ cleanupExpired, evictOldest, ttlDays: 90, maxCount: 0 });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Cleaned up 10 vectors (10 expired, 0 evicted by FIFO cap)');
    expect(result.details).toEqual({ expiredCount: 10, evictedCount: 0, ttlDays: 90, maxCount: 0 });
    expect(cleanupExpired).toHaveBeenCalledWith(90);
  });

  it('returns failure when cleanup throws', async () => {
    const cleanupExpired = vi.fn().mockRejectedValue(new Error('vector store unavailable'));
    const evictOldest = vi.fn().mockResolvedValue(0);

    const result = await cleanupVectors({ cleanupExpired, evictOldest, ttlDays: 30, maxCount: 0 });

    expect(result.success).toBe(false);
    expect(result.message).toContain('vector store unavailable');
  });

  it('handles zero deletions', async () => {
    const cleanupExpired = vi.fn().mockResolvedValue(0);
    const evictOldest = vi.fn().mockResolvedValue(0);

    const result = await cleanupVectors({ cleanupExpired, evictOldest, ttlDays: 90, maxCount: 0 });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Cleaned up 0 vectors (0 expired, 0 evicted by FIFO cap)');
  });

  it('passes correct TTL days to cleanup function', async () => {
    const cleanupExpired = vi.fn().mockResolvedValue(0);
    const evictOldest = vi.fn().mockResolvedValue(0);

    await cleanupVectors({ cleanupExpired, evictOldest, ttlDays: 45, maxCount: 0 });

    expect(cleanupExpired).toHaveBeenCalledWith(45);
  });
});
