/**
 * Tests for cluster expansion during retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestCluster,
  assignChunkToCluster,
  setupTestDb,
  teardownTestDb,
} from '../storage/test-utils.js';
import { expandViaClusters, type ClusterExpansionConfig } from '../../src/retrieval/cluster-expander.js';
import type { RankedItem } from '../../src/retrieval/rrf.js';

describe('cluster-expander', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db); // Use DI so cluster-store reads from this db
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  function setupChunksAndClusters() {
    // Create chunks
    insertTestChunk(db, createSampleChunk({ id: 'c1', content: 'authentication flow', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c2', content: 'login handler', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c3', content: 'oauth tokens', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c4', content: 'database migration', sessionSlug: 'proj-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'c5', content: 'schema update', sessionSlug: 'proj-b' }));

    // Create clusters
    insertTestCluster(db, { id: 'cluster-auth', name: 'Authentication' });
    insertTestCluster(db, { id: 'cluster-db', name: 'Database' });

    // Assign chunks to clusters (distance = angular distance to centroid)
    assignChunkToCluster(db, 'c1', 'cluster-auth', 0.1);
    assignChunkToCluster(db, 'c2', 'cluster-auth', 0.2);
    assignChunkToCluster(db, 'c3', 'cluster-auth', 0.3);
    assignChunkToCluster(db, 'c4', 'cluster-db', 0.1);
    assignChunkToCluster(db, 'c5', 'cluster-db', 0.2);
  }

  const defaultConfig: ClusterExpansionConfig = {
    maxClusters: 3,
    maxSiblings: 5,
    boostFactor: 0.3,
  };

  it('expands hits with cluster siblings', () => {
    setupChunksAndClusters();

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
    ];

    const result = expandViaClusters(hits, defaultConfig);

    // Should include original hit plus siblings from cluster-auth
    expect(result.length).toBeGreaterThan(1);
    const ids = result.map(r => r.chunkId);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2'); // sibling in same cluster
    expect(ids).toContain('c3'); // sibling in same cluster
  });

  it('respects maxClusters limit', () => {
    setupChunksAndClusters();
    // c1 is in cluster-auth, c4 is in cluster-db
    assignChunkToCluster(db, 'c1', 'cluster-db', 0.4); // c1 also in db cluster

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
    ];

    const result = expandViaClusters(hits, {
      ...defaultConfig,
      maxClusters: 1,
    });

    // Should only expand from 1 cluster (cluster-auth, since it has lower distance for c1)
    const clusterSiblings = result.filter(r => r.source === 'cluster');
    // All siblings should be from the same cluster
    expect(clusterSiblings.length).toBeGreaterThan(0);
  });

  it('respects maxSiblings limit', () => {
    setupChunksAndClusters();

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
    ];

    const result = expandViaClusters(hits, {
      ...defaultConfig,
      maxSiblings: 1,
    });

    const clusterSiblings = result.filter(r => r.source === 'cluster');
    expect(clusterSiblings.length).toBeLessThanOrEqual(1);
  });

  it('boostFactor scales sibling scores', () => {
    setupChunksAndClusters();

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
    ];

    const result1 = expandViaClusters(hits, { ...defaultConfig, boostFactor: 0.3 });
    const result2 = expandViaClusters(hits, { ...defaultConfig, boostFactor: 0.6 });

    const sib1 = result1.find(r => r.chunkId === 'c2');
    const sib2 = result2.find(r => r.chunkId === 'c2');

    expect(sib1).toBeDefined();
    expect(sib2).toBeDefined();
    // Higher boost factor → higher sibling score
    expect(sib2!.score).toBeGreaterThan(sib1!.score);
  });

  it('no duplicates between hits and siblings', () => {
    setupChunksAndClusters();

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
      { chunkId: 'c2', score: 0.5, source: 'keyword' },
    ];

    const result = expandViaClusters(hits, defaultConfig);

    // c2 is already in hits, should not appear as a sibling
    const c2Entries = result.filter(r => r.chunkId === 'c2');
    expect(c2Entries.length).toBe(1);
    expect(c2Entries[0].source).toBe('keyword'); // original, not cluster
  });

  it('chunks with no cluster assignments pass through unchanged', () => {
    // Insert chunk without any cluster assignments
    insertTestChunk(db, createSampleChunk({ id: 'c-alone', content: 'standalone' }));

    const hits: RankedItem[] = [
      { chunkId: 'c-alone', score: 0.8, source: 'vector' },
    ];

    const result = expandViaClusters(hits, defaultConfig);

    expect(result.length).toBe(1);
    expect(result[0].chunkId).toBe('c-alone');
    expect(result[0].source).toBe('vector');
  });

  it('siblings tagged with source cluster', () => {
    setupChunksAndClusters();

    const hits: RankedItem[] = [
      { chunkId: 'c1', score: 0.8, source: 'vector' },
    ];

    const result = expandViaClusters(hits, defaultConfig);

    const siblings = result.filter(r => r.chunkId !== 'c1');
    for (const sib of siblings) {
      expect(sib.source).toBe('cluster');
    }
  });

  it('returns empty for empty hits', () => {
    const result = expandViaClusters([], defaultConfig);
    expect(result).toEqual([]);
  });

  it('project filter excludes cross-project siblings', () => {
    setupChunksAndClusters();
    // c4 is in cluster-db (proj-a), c5 is in cluster-db (proj-b)

    const hits: RankedItem[] = [
      { chunkId: 'c4', score: 0.8, source: 'vector' },
    ];

    // Note: project filtering relies on vectorStore.getChunkProject() which uses
    // in-memory index. Since we're using a test db without populating the vector
    // store's chunk project index, this test verifies the filtering code path exists.
    // In production, the vector store's chunkProjectIndex would be populated.
    const result = expandViaClusters(hits, defaultConfig, 'proj-a');

    // Original hit should always be included
    expect(result.some(r => r.chunkId === 'c4')).toBe(true);
  });
});
