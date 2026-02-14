/**
 * Tests for collection health benchmarks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  setupTestDb,
  teardownTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestEdge,
  insertTestCluster,
  assignChunkToCluster,
} from '../../storage/test-utils.js';
import { invalidateProjectsCache } from '../../../src/storage/chunk-store.js';
import { runHealthBenchmarks } from '../../../src/eval/collection-benchmark/health.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
  invalidateProjectsCache();
});

afterEach(() => {
  teardownTestDb(db);
});

describe('runHealthBenchmarks', () => {
  it('should return zeros for empty collection', async () => {
    const result = await runHealthBenchmarks();

    expect(result.chunkCount).toBe(0);
    expect(result.projectCount).toBe(0);
    expect(result.sessionCount).toBe(0);
    expect(result.edgeCount).toBe(0);
    expect(result.edgeToChunkRatio).toBe(0);
    expect(result.clusterCount).toBe(0);
    expect(result.clusterCoverage).toBe(0);
    expect(result.orphanChunkPercentage).toBe(0);
    expect(result.temporalSpan).toBeNull();
    expect(result.sessionSizeStats).toBeNull();
    expect(result.clusterQuality).toBeNull();
  });

  it('should compute basic health metrics', async () => {
    // Insert 3 chunks
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c1',
        sessionId: 's1',
        sessionSlug: 'proj-a',
        startTime: '2024-01-01T00:00:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c2',
        sessionId: 's1',
        sessionSlug: 'proj-a',
        startTime: '2024-01-02T00:00:00Z',
      }),
    );
    insertTestChunk(
      db,
      createSampleChunk({
        id: 'c3',
        sessionId: 's2',
        sessionSlug: 'proj-a',
        startTime: '2024-06-01T00:00:00Z',
      }),
    );

    // Insert 2 edges
    insertTestEdge(db, {
      id: 'e1',
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
      referenceType: 'within-chain',
    });
    insertTestEdge(db, {
      id: 'e2',
      sourceChunkId: 'c2',
      targetChunkId: 'c3',
      edgeType: 'backward',
      referenceType: 'cross-session',
    });

    const result = await runHealthBenchmarks();

    expect(result.chunkCount).toBe(3);
    expect(result.projectCount).toBe(1);
    expect(result.sessionCount).toBe(2);
    expect(result.edgeCount).toBe(2);
    expect(result.edgeToChunkRatio).toBeCloseTo(2 / 3);
    expect(result.temporalSpan).not.toBeNull();
    expect(result.temporalSpan!.earliest).toBe('2024-01-01T00:00:00Z');
  });

  it('should compute cluster coverage', async () => {
    insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c4', sessionId: 's1', sessionSlug: 'proj-a' }));

    insertTestCluster(db, { id: 'cl1' });
    assignChunkToCluster(db, 'c1', 'cl1', 0.1);
    assignChunkToCluster(db, 'c2', 'cl1', 0.2);
    assignChunkToCluster(db, 'c3', 'cl1', 0.3);

    const result = await runHealthBenchmarks();

    expect(result.clusterCount).toBe(1);
    expect(result.clusterCoverage).toBeCloseTo(0.75); // 3 out of 4
  });

  it('should identify orphan chunks', async () => {
    insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 's1', sessionSlug: 'proj-a' }));

    // Only c1 and c2 have edges
    insertTestEdge(db, {
      id: 'e1',
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
    });
    // c3 is orphan (no edges, no cluster)

    const result = await runHealthBenchmarks();

    expect(result.orphanChunkPercentage).toBeCloseTo(1 / 3);
  });

  it('should compute edge type distribution', async () => {
    insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 's1', sessionSlug: 'proj-a' }));

    insertTestEdge(db, {
      id: 'e1',
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
      referenceType: 'within-chain',
    });
    insertTestEdge(db, {
      id: 'e2',
      sourceChunkId: 'c2',
      targetChunkId: 'c3',
      edgeType: 'backward',
      referenceType: 'within-chain',
    });
    insertTestEdge(db, {
      id: 'e3',
      sourceChunkId: 'c1',
      targetChunkId: 'c3',
      edgeType: 'backward',
      referenceType: 'cross-session',
    });

    const result = await runHealthBenchmarks();

    expect(result.edgeTypeDistribution.length).toBe(2);
    const withinChainDist = result.edgeTypeDistribution.find((d) => d.type === 'within-chain');
    expect(withinChainDist?.count).toBe(2);
    expect(withinChainDist?.percentage).toBeCloseTo(2 / 3);
  });

  it('should compute session size stats', async () => {
    insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 's2', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c4', sessionId: 's2', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c5', sessionId: 's2', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c6', sessionId: 's2', sessionSlug: 'proj-a' }));

    const result = await runHealthBenchmarks();

    expect(result.sessionSizeStats).not.toBeNull();
    expect(result.sessionSizeStats!.min).toBe(2);
    expect(result.sessionSizeStats!.max).toBe(4);
    expect(result.sessionSizeStats!.mean).toBe(3);
    expect(result.sessionSizeStats!.median).toBe(3);
  });

  it('should compute per-project breakdown', async () => {
    insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 's1', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 's2', sessionSlug: 'proj-b' }));

    insertTestEdge(db, {
      id: 'e1',
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
    });

    const result = await runHealthBenchmarks();

    expect(result.perProject.length).toBe(2);
    const projA = result.perProject.find((p) => p.slug === 'proj-a');
    const projB = result.perProject.find((p) => p.slug === 'proj-b');
    expect(projA?.chunkCount).toBe(2);
    expect(projA?.edgeCount).toBe(1);
    expect(projB?.chunkCount).toBe(1);
    expect(projB?.orphanPercentage).toBe(1); // c3 has no edges
  });
});
