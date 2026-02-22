/**
 * Tests for incremental clustering support in updateClusters.
 */

import { describe, it, expect, vi } from 'vitest';
import { updateClusters } from '../../src/maintenance/tasks/update-clusters.js';

describe('updateClusters — incremental', () => {
  const mockClusteringResult = {
    numClusters: 5,
    assignedChunks: 150,
    noiseChunks: 20,
    noiseRatio: 0.117,
    clusterSizes: [45, 35, 30, 25, 15],
    reassignedNoise: 0,
    durationMs: 500,
  };

  it('uses incrementalAssign when new chunks are available', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn().mockResolvedValue({
      assigned: 10,
      noise: 2,
      usedFullRecluster: false,
    });
    const getNewChunkIds = vi.fn().mockReturnValue(['c1', 'c2', 'c3']);

    const result = await updateClusters({
      recluster,
      incrementalAssign,
      getNewChunkIds,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Incremental');
    expect(result.message).toContain('10 assigned');
    expect(result.message).toContain('2 noise');
    expect(incrementalAssign).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
    expect(recluster).not.toHaveBeenCalled();
  });

  it('reports full recluster fallback from incrementalAssign', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn().mockResolvedValue({
      assigned: 50,
      noise: 0,
      usedFullRecluster: true,
    });
    const getNewChunkIds = vi.fn().mockReturnValue(['c1']);

    const result = await updateClusters({
      recluster,
      incrementalAssign,
      getNewChunkIds,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Full recluster');
    expect(result.message).toContain('50 assigned');
  });

  it('falls back to recluster when no new chunks', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn();
    const getNewChunkIds = vi.fn().mockReturnValue([]);

    const result = await updateClusters({
      recluster,
      incrementalAssign,
      getNewChunkIds,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('5 clusters');
    expect(incrementalAssign).not.toHaveBeenCalled();
    expect(recluster).toHaveBeenCalledOnce();
  });

  it('falls back to recluster when getNewChunkIds is not provided', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn();

    const result = await updateClusters({
      recluster,
      incrementalAssign,
    });

    expect(result.success).toBe(true);
    expect(incrementalAssign).not.toHaveBeenCalled();
    expect(recluster).toHaveBeenCalledOnce();
  });

  it('includes label refresh count with incremental assignment', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn().mockResolvedValue({
      assigned: 5,
      noise: 1,
      usedFullRecluster: false,
    });
    const getNewChunkIds = vi.fn().mockReturnValue(['c1']);
    const refreshLabels = vi.fn().mockResolvedValue([{}, {}]);

    const result = await updateClusters({
      recluster,
      incrementalAssign,
      getNewChunkIds,
      refreshLabels,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('2 labels refreshed');
  });

  it('returns failure when incrementalAssign throws', async () => {
    const recluster = vi.fn().mockResolvedValue(mockClusteringResult);
    const incrementalAssign = vi.fn().mockRejectedValue(new Error('model corrupt'));
    const getNewChunkIds = vi.fn().mockReturnValue(['c1']);

    const result = await updateClusters({
      recluster,
      incrementalAssign,
      getNewChunkIds,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('model corrupt');
  });
});
