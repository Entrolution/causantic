/**
 * Tests for cluster store CRUD operations.
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
} from './test-utils.js';
import {
  getClusterProjectRelevance,
  getClustersWithDescriptions,
} from '../../src/storage/cluster-store.js';

describe('cluster-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertCluster', () => {
    it('creates a cluster with all fields', () => {
      const centroid = new Float32Array([0.1, 0.2, 0.3]);
      const centroidBuffer = Buffer.from(centroid.buffer);

      db.prepare(
        `
        INSERT INTO clusters (id, name, description, centroid, exemplar_ids, membership_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      ).run(
        'cluster-1',
        'Test Cluster',
        'A test description',
        centroidBuffer,
        JSON.stringify(['chunk-1', 'chunk-2']),
        'hash123',
      );

      const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get('cluster-1') as {
        id: string;
        name: string | null;
        description: string | null;
        centroid: Buffer | null;
        exemplar_ids: string | null;
        membership_hash: string | null;
      };

      expect(row).toBeDefined();
      expect(row.name).toBe('Test Cluster');
      expect(row.description).toBe('A test description');
      expect(row.centroid).toBeDefined();
      expect(row.membership_hash).toBe('hash123');
      expect(JSON.parse(row.exemplar_ids!)).toEqual(['chunk-1', 'chunk-2']);
    });

    it('creates a cluster with null optional fields', () => {
      db.prepare(
        `
        INSERT INTO clusters (id, created_at)
        VALUES (?, datetime('now'))
      `,
      ).run('cluster-2');

      const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get('cluster-2') as {
        name: string | null;
        description: string | null;
        centroid: Buffer | null;
      };

      expect(row.name).toBeNull();
      expect(row.description).toBeNull();
      expect(row.centroid).toBeNull();
    });

    it('updates existing cluster', () => {
      db.prepare(
        `
        INSERT INTO clusters (id, name, created_at)
        VALUES (?, ?, datetime('now'))
      `,
      ).run('cluster-1', 'Original Name');

      db.prepare('UPDATE clusters SET name = ?, description = ? WHERE id = ?').run(
        'Updated Name',
        'New description',
        'cluster-1',
      );

      const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get('cluster-1') as {
        name: string;
        description: string;
      };

      expect(row.name).toBe('Updated Name');
      expect(row.description).toBe('New description');
    });
  });

  describe('getClusterById', () => {
    it('returns null for non-existent cluster', () => {
      const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get('non-existent');
      expect(row).toBeUndefined();
    });

    it('returns the cluster when it exists', () => {
      insertTestCluster(db, { id: 'existing-cluster', name: 'Test' });

      const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get('existing-cluster');
      expect(row).toBeDefined();
    });
  });

  describe('getAllClusters', () => {
    it('returns empty array when no clusters exist', () => {
      const rows = db.prepare('SELECT * FROM clusters ORDER BY created_at').all();
      expect(rows).toEqual([]);
    });

    it('returns all clusters', () => {
      insertTestCluster(db, { id: 'c1', name: 'Cluster 1' });
      insertTestCluster(db, { id: 'c2', name: 'Cluster 2' });
      insertTestCluster(db, { id: 'c3', name: 'Cluster 3' });

      const rows = db.prepare('SELECT * FROM clusters ORDER BY created_at').all();
      expect(rows.length).toBe(3);
    });
  });

  describe('assignChunkToCluster', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1', name: 'Test Cluster' });
    });

    it('creates a chunk-cluster assignment', () => {
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.25);

      const row = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ? AND cluster_id = ?')
        .get('chunk-1', 'cluster-1') as {
        chunk_id: string;
        cluster_id: string;
        distance: number;
      };

      expect(row).toBeDefined();
      expect(row.distance).toBeCloseTo(0.25);
    });

    it('replaces existing assignment on conflict', () => {
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.5);

      // Update with new distance using INSERT OR REPLACE
      db.prepare(
        `
        INSERT OR REPLACE INTO chunk_clusters (chunk_id, cluster_id, distance)
        VALUES (?, ?, ?)
      `,
      ).run('chunk-1', 'cluster-1', 0.3);

      const row = db
        .prepare('SELECT distance FROM chunk_clusters WHERE chunk_id = ? AND cluster_id = ?')
        .get('chunk-1', 'cluster-1') as { distance: number };

      expect(row.distance).toBeCloseTo(0.3);
    });
  });

  describe('getChunkClusterAssignments', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1' });
      insertTestCluster(db, { id: 'cluster-2' });
    });

    it('returns empty array for unassigned chunk', () => {
      const rows = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ? ORDER BY distance')
        .all('chunk-1');
      expect(rows).toEqual([]);
    });

    it('returns assignments ordered by distance', () => {
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.5);
      assignChunkToCluster(db, 'chunk-1', 'cluster-2', 0.2);

      const rows = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ? ORDER BY distance')
        .all('chunk-1') as { cluster_id: string; distance: number }[];

      expect(rows.length).toBe(2);
      expect(rows[0].cluster_id).toBe('cluster-2'); // Closer first
      expect(rows[1].cluster_id).toBe('cluster-1');
    });
  });

  describe('getClusterChunkIds', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestChunk(db, createSampleChunk({ id: 'chunk-2' }));
      insertTestChunk(db, createSampleChunk({ id: 'chunk-3' }));
      insertTestCluster(db, { id: 'cluster-1' });
    });

    it('returns chunk IDs in a cluster', () => {
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);
      assignChunkToCluster(db, 'chunk-2', 'cluster-1', 0.1);
      assignChunkToCluster(db, 'chunk-3', 'cluster-1', 0.5);

      const rows = db
        .prepare('SELECT chunk_id FROM chunk_clusters WHERE cluster_id = ? ORDER BY distance')
        .all('cluster-1') as { chunk_id: string }[];
      const ids = rows.map((r) => r.chunk_id);

      expect(ids).toEqual(['chunk-2', 'chunk-1', 'chunk-3']); // Ordered by distance
    });
  });

  describe('removeChunkAssignments', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1' });
      insertTestCluster(db, { id: 'cluster-2' });
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);
      assignChunkToCluster(db, 'chunk-1', 'cluster-2', 0.5);
    });

    it('removes all assignments for a chunk', () => {
      const result = db.prepare('DELETE FROM chunk_clusters WHERE chunk_id = ?').run('chunk-1');
      expect(result.changes).toBe(2);

      const remaining = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ?')
        .all('chunk-1');
      expect(remaining).toEqual([]);
    });
  });

  describe('clearClusterAssignments', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestChunk(db, createSampleChunk({ id: 'chunk-2' }));
      insertTestCluster(db, { id: 'cluster-1' });
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);
      assignChunkToCluster(db, 'chunk-2', 'cluster-1', 0.5);
    });

    it('removes all assignments for a cluster', () => {
      const result = db.prepare('DELETE FROM chunk_clusters WHERE cluster_id = ?').run('cluster-1');
      expect(result.changes).toBe(2);

      const remaining = db
        .prepare('SELECT * FROM chunk_clusters WHERE cluster_id = ?')
        .all('cluster-1');
      expect(remaining).toEqual([]);
    });
  });

  describe('deleteCluster', () => {
    beforeEach(() => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1', name: 'To Delete' });
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);
    });

    it('deletes cluster and its assignments', () => {
      // Delete assignments first (to respect FK), then cluster
      db.prepare('DELETE FROM chunk_clusters WHERE cluster_id = ?').run('cluster-1');
      const result = db.prepare('DELETE FROM clusters WHERE id = ?').run('cluster-1');
      expect(result.changes).toBe(1);

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get('cluster-1');
      expect(cluster).toBeUndefined();

      const assignments = db
        .prepare('SELECT * FROM chunk_clusters WHERE cluster_id = ?')
        .all('cluster-1');
      expect(assignments).toEqual([]);
    });
  });

  describe('getClusterCount', () => {
    it('returns 0 for empty database', () => {
      const row = db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
      expect(row.count).toBe(0);
    });

    it('returns correct count', () => {
      insertTestCluster(db, { id: 'c1' });
      insertTestCluster(db, { id: 'c2' });
      insertTestCluster(db, { id: 'c3' });

      const row = db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
      expect(row.count).toBe(3);
    });
  });

  describe('centroid serialization', () => {
    it('round-trips centroid data', () => {
      const originalCentroid = [0.1, 0.2, 0.3, 0.4, 0.5];
      const float32 = new Float32Array(originalCentroid);
      const buffer = Buffer.from(float32.buffer);

      db.prepare(
        `
        INSERT INTO clusters (id, centroid, created_at)
        VALUES (?, ?, datetime('now'))
      `,
      ).run('centroid-test', buffer);

      const row = db.prepare('SELECT centroid FROM clusters WHERE id = ?').get('centroid-test') as {
        centroid: Buffer;
      };

      const restored = new Float32Array(
        row.centroid.buffer,
        row.centroid.byteOffset,
        row.centroid.length / Float32Array.BYTES_PER_ELEMENT,
      );

      expect(Array.from(restored)).toEqual(originalCentroid.map((v) => expect.closeTo(v, 5)));
    });
  });

  describe('exemplar IDs serialization', () => {
    it('round-trips exemplar IDs', () => {
      const exemplarIds = ['chunk-1', 'chunk-2', 'chunk-3'];

      insertTestCluster(db, {
        id: 'exemplar-test',
        exemplarIds,
      });

      const row = db
        .prepare('SELECT exemplar_ids FROM clusters WHERE id = ?')
        .get('exemplar-test') as {
        exemplar_ids: string;
      };

      expect(JSON.parse(row.exemplar_ids)).toEqual(exemplarIds);
    });
  });

  describe('stale cluster detection', () => {
    it('identifies clusters without refreshed_at', () => {
      db.prepare(
        `
        INSERT INTO clusters (id, name, created_at, refreshed_at)
        VALUES (?, ?, datetime('now'), NULL)
      `,
      ).run('stale-1', 'Stale Cluster');

      db.prepare(
        `
        INSERT INTO clusters (id, name, created_at, refreshed_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
      `,
      ).run('fresh-1', 'Fresh Cluster');

      const stale = db.prepare('SELECT * FROM clusters WHERE refreshed_at IS NULL').all();
      expect(stale.length).toBe(1);
    });
  });

  describe('cascade deletion', () => {
    it('deletes assignments when chunk is deleted', () => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1' });
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);

      db.prepare('DELETE FROM chunks WHERE id = ?').run('chunk-1');

      const assignments = db
        .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ?')
        .all('chunk-1');
      expect(assignments).toEqual([]);
    });

    it('deletes assignments when cluster is deleted', () => {
      insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
      insertTestCluster(db, { id: 'cluster-1' });
      assignChunkToCluster(db, 'chunk-1', 'cluster-1', 0.3);

      db.prepare('DELETE FROM clusters WHERE id = ?').run('cluster-1');

      const assignments = db
        .prepare('SELECT * FROM chunk_clusters WHERE cluster_id = ?')
        .all('cluster-1');
      expect(assignments).toEqual([]);
    });
  });
});

describe('getClusterProjectRelevance', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('returns relevant clusters with correct relevance scores', () => {
    insertTestCluster(db, { id: 'c1', name: 'Cluster 1' });
    insertTestChunk(db, createSampleChunk({ id: 'ch1', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch3', sessionSlug: 'other-project' }));
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch2', 'c1', 0.2);
    assignChunkToCluster(db, 'ch3', 'c1', 0.3);

    const results = getClusterProjectRelevance(['c1'], 'my-project');

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe('c1');
    expect(results[0].relevance).toBeCloseTo(2 / 3);
  });

  it('excludes clusters with no project chunks', () => {
    insertTestCluster(db, { id: 'c1', name: 'Relevant' });
    insertTestCluster(db, { id: 'c2', name: 'Irrelevant' });
    insertTestChunk(db, createSampleChunk({ id: 'ch1', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2', sessionSlug: 'other-project' }));
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch2', 'c2', 0.1);

    const results = getClusterProjectRelevance(['c1', 'c2'], 'my-project');

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe('c1');
  });

  it('returns empty array for empty input', () => {
    const results = getClusterProjectRelevance([], 'my-project');
    expect(results).toEqual([]);
  });

  it('handles clusters with mixed project membership', () => {
    insertTestCluster(db, { id: 'c1', name: 'Mostly mine' });
    insertTestCluster(db, { id: 'c2', name: 'Partly mine' });
    // c1: 3 project chunks, 1 other = 75% relevance
    insertTestChunk(db, createSampleChunk({ id: 'ch1', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch3', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch4', sessionSlug: 'other-project' }));
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch2', 'c1', 0.2);
    assignChunkToCluster(db, 'ch3', 'c1', 0.3);
    assignChunkToCluster(db, 'ch4', 'c1', 0.4);

    // c2: 1 project chunk, 3 other = 25% relevance
    insertTestChunk(db, createSampleChunk({ id: 'ch5', sessionSlug: 'my-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch6', sessionSlug: 'other-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch7', sessionSlug: 'other-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch8', sessionSlug: 'other-project' }));
    assignChunkToCluster(db, 'ch5', 'c2', 0.1);
    assignChunkToCluster(db, 'ch6', 'c2', 0.2);
    assignChunkToCluster(db, 'ch7', 'c2', 0.3);
    assignChunkToCluster(db, 'ch8', 'c2', 0.4);

    const results = getClusterProjectRelevance(['c1', 'c2'], 'my-project');

    expect(results).toHaveLength(2);
    // Sorted by relevance desc
    expect(results[0].clusterId).toBe('c1');
    expect(results[0].relevance).toBeCloseTo(0.75);
    expect(results[1].clusterId).toBe('c2');
    expect(results[1].relevance).toBeCloseTo(0.25);
  });
});

describe('getClustersWithDescriptions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('returns only clusters that have a description', () => {
    insertTestCluster(db, { id: 'c1', name: 'With desc', description: 'Has a description' });
    insertTestCluster(db, { id: 'c2', name: 'No desc' });
    insertTestCluster(db, { id: 'c3', name: 'Also has desc', description: 'Another description' });

    const results = getClustersWithDescriptions();

    expect(results).toHaveLength(2);
    expect(results.map((c) => c.id).sort()).toEqual(['c1', 'c3']);
  });

  it('returns empty array when no clusters have descriptions', () => {
    insertTestCluster(db, { id: 'c1', name: 'No desc' });
    insertTestCluster(db, { id: 'c2', name: 'Also no desc' });

    const results = getClustersWithDescriptions();
    expect(results).toEqual([]);
  });

  it('returns empty array when no clusters exist', () => {
    const results = getClustersWithDescriptions();
    expect(results).toEqual([]);
  });
});
