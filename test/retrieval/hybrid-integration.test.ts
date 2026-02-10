/**
 * Integration tests for the hybrid BM25 + vector search pipeline.
 *
 * Tests the full flow: keyword search → RRF fusion → cluster expansion
 * without requiring the ML embedding model (uses mock embeddings).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestCluster,
  assignChunkToCluster,
  setupTestDb,
  teardownTestDb,
} from '../storage/test-utils.js';
import { KeywordStore } from '../../src/storage/keyword-store.js';
import { fuseRRF, type RankedItem, type RRFSource } from '../../src/retrieval/rrf.js';
import { expandViaClusters, type ClusterExpansionConfig } from '../../src/retrieval/cluster-expander.js';

describe('hybrid-integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  function insertChunks() {
    // Auth-related chunks
    insertTestChunk(db, createSampleChunk({
      id: 'auth-1', content: 'User authentication using JWT tokens and refresh tokens',
      sessionSlug: 'my-app',
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'auth-2', content: 'OAuth2 configuration for Google sign-in authentication',
      sessionSlug: 'my-app',
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'auth-3', content: 'Session management and cookie-based auth',
      sessionSlug: 'my-app',
    }));

    // Database chunks
    insertTestChunk(db, createSampleChunk({
      id: 'db-1', content: 'Database migration from PostgreSQL to SQLite',
      sessionSlug: 'my-app',
    }));
    insertTestChunk(db, createSampleChunk({
      id: 'db-2', content: 'Schema versioning and incremental updates',
      sessionSlug: 'my-app',
    }));

    // Cross-project chunk
    insertTestChunk(db, createSampleChunk({
      id: 'other-1', content: 'Authentication middleware for Express',
      sessionSlug: 'other-project',
    }));

    // Create clusters
    insertTestCluster(db, { id: 'cl-auth', name: 'Authentication' });
    insertTestCluster(db, { id: 'cl-db', name: 'Database' });

    // Assign to clusters
    assignChunkToCluster(db, 'auth-1', 'cl-auth', 0.1);
    assignChunkToCluster(db, 'auth-2', 'cl-auth', 0.15);
    assignChunkToCluster(db, 'auth-3', 'cl-auth', 0.2);
    assignChunkToCluster(db, 'other-1', 'cl-auth', 0.25);
    assignChunkToCluster(db, 'db-1', 'cl-db', 0.1);
    assignChunkToCluster(db, 'db-2', 'cl-db', 0.15);
  }

  it('full pipeline: keyword → RRF → cluster expansion', () => {
    insertChunks();

    const keywordStore = new KeywordStore(db);

    // 1. Simulate vector search results (normally from embedder)
    const vectorResults: RankedItem[] = [
      { chunkId: 'auth-1', score: 0.85, source: 'vector' },
      { chunkId: 'auth-3', score: 0.60, source: 'vector' },
      { chunkId: 'db-1', score: 0.30, source: 'vector' },
    ];

    // 2. Run keyword search
    const keywordResults = keywordStore.search('authentication JWT', 10);
    expect(keywordResults.length).toBeGreaterThan(0);

    const keywordItems: RankedItem[] = keywordResults.map(r => ({
      chunkId: r.id,
      score: r.score,
      source: 'keyword' as const,
    }));

    // 3. RRF fusion
    const fused = fuseRRF([
      { items: vectorResults, weight: 1.0 },
      { items: keywordItems, weight: 1.0 },
    ]);

    expect(fused.length).toBeGreaterThan(0);

    // auth-1 should be near the top (appears in both vector and keyword)
    const auth1 = fused.find(r => r.chunkId === 'auth-1');
    expect(auth1).toBeDefined();

    // 4. Cluster expansion
    const expanded = expandViaClusters(fused, {
      maxClusters: 3,
      maxSiblings: 5,
      boostFactor: 0.3,
    });

    // Expanded should include cluster siblings
    expect(expanded.length).toBeGreaterThanOrEqual(fused.length);

    // Source attribution should be present
    for (const item of expanded) {
      expect(item.source).toBeDefined();
    }
  });

  it('keyword search finds lexically relevant chunks missed by vector search', () => {
    insertChunks();

    const keywordStore = new KeywordStore(db);

    // Simulate: vector search misses auth-2 (about Google sign-in) but keyword finds it
    const vectorResults: RankedItem[] = [
      { chunkId: 'auth-1', score: 0.85, source: 'vector' },
    ];

    const keywordResults = keywordStore.search('Google sign-in', 10);
    const keywordItems: RankedItem[] = keywordResults.map(r => ({
      chunkId: r.id,
      score: r.score,
      source: 'keyword' as const,
    }));

    const fused = fuseRRF([
      { items: vectorResults, weight: 1.0 },
      { items: keywordItems, weight: 1.0 },
    ]);

    // Google sign-in chunk should appear in fused results thanks to keyword search
    const googleResult = fused.find(r => r.chunkId === 'auth-2');
    expect(googleResult).toBeDefined();
    expect(googleResult!.source).toBe('keyword');
  });

  it('project filtering works in keyword search', () => {
    insertChunks();

    const keywordStore = new KeywordStore(db);

    // Search with project filter
    const filtered = keywordStore.searchByProject('authentication', 'my-app', 10);
    const unfiltered = keywordStore.search('authentication', 10);

    // Filtered should not include other-1 (from other-project)
    const filteredIds = filtered.map(r => r.id);
    const unfilteredIds = unfiltered.map(r => r.id);

    expect(filteredIds).not.toContain('other-1');
    expect(unfilteredIds).toContain('other-1');
  });

  it('graceful fallback when keyword search fails', () => {
    insertChunks();

    // Simulate keyword search failure by using store with broken FTS
    const brokenDb = new Database(':memory:');
    brokenDb.pragma('foreign_keys = ON');
    // No FTS5 table — search should return empty, not throw
    const brokenStore = new KeywordStore(brokenDb);

    const results = brokenStore.search('authentication', 10);
    expect(results).toEqual([]);

    brokenDb.close();
  });

  it('cluster expansion adds topically related chunks', () => {
    insertChunks();

    // Only auth-1 from search, but cluster expansion should find auth-2 and auth-3
    const searchHits: RankedItem[] = [
      { chunkId: 'auth-1', score: 0.8, source: 'vector' },
    ];

    const expanded = expandViaClusters(searchHits, {
      maxClusters: 3,
      maxSiblings: 5,
      boostFactor: 0.3,
    });

    const ids = expanded.map(r => r.chunkId);
    expect(ids).toContain('auth-1');
    expect(ids).toContain('auth-2'); // cluster sibling
    expect(ids).toContain('auth-3'); // cluster sibling

    // Siblings should have source: 'cluster'
    const auth2 = expanded.find(r => r.chunkId === 'auth-2');
    expect(auth2?.source).toBe('cluster');
  });

  it('RRF correctly handles chunks appearing in both sources', () => {
    insertChunks();

    const keywordStore = new KeywordStore(db);

    // auth-1 appears in both vector and keyword
    const vectorResults: RankedItem[] = [
      { chunkId: 'auth-1', score: 0.8, source: 'vector' },
      { chunkId: 'db-1', score: 0.5, source: 'vector' },
    ];

    const keywordResults = keywordStore.search('authentication JWT tokens', 10);
    const keywordItems: RankedItem[] = keywordResults.map(r => ({
      chunkId: r.id,
      score: r.score,
      source: 'keyword' as const,
    }));

    const fused = fuseRRF([
      { items: vectorResults, weight: 1.0 },
      { items: keywordItems, weight: 1.0 },
    ]);

    // auth-1 should have a higher fused score than items only in one source
    const auth1 = fused.find(r => r.chunkId === 'auth-1');
    const db1 = fused.find(r => r.chunkId === 'db-1');

    expect(auth1).toBeDefined();
    if (db1) {
      // auth-1 appeared in both sources, should have higher score
      expect(auth1!.score).toBeGreaterThan(db1.score);
    }
  });
});
