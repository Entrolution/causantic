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
  upsertCluster,
  getClusterById,
  getAllClusters,
  getStaleClusters,
  getClusterProjectRelevance,
  getClustersWithDescriptions,
  assignChunksToClusters,
  deleteCluster,
  getClusterChunkIds,
  getChunkClusterAssignments,
  removeChunkAssignments,
  clearClusterAssignments,
  clearAllClusters,
  getClusterCount,
  computeMembershipHash,
  assignChunkToCluster as assignChunkToClusterFn,
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

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests using actual store functions via DI
// ─────────────────────────────────────────────────────────────────────────────

describe('upsertCluster (via store function)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('creates a new cluster and returns its id', () => {
    const id = upsertCluster({ name: 'New Cluster', description: 'A description' });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const cluster = getClusterById(id);
    expect(cluster).not.toBeNull();
    expect(cluster!.name).toBe('New Cluster');
    expect(cluster!.description).toBe('A description');
  });

  it('creates a cluster with a provided id', () => {
    const id = upsertCluster({ id: 'my-cluster', name: 'Named' });

    expect(id).toBe('my-cluster');
    const cluster = getClusterById('my-cluster');
    expect(cluster).not.toBeNull();
    expect(cluster!.name).toBe('Named');
  });

  it('creates a cluster with no optional fields', () => {
    const id = upsertCluster({});

    const cluster = getClusterById(id);
    expect(cluster).not.toBeNull();
    expect(cluster!.name).toBeNull();
    expect(cluster!.description).toBeNull();
    expect(cluster!.centroid).toBeNull();
    expect(cluster!.exemplarIds).toEqual([]);
    expect(cluster!.membershipHash).toBeNull();
    expect(cluster!.refreshedAt).toBeNull();
  });

  it('sets refreshed_at on create when description is provided', () => {
    const id = upsertCluster({ description: 'Has description' });

    const cluster = getClusterById(id);
    expect(cluster!.refreshedAt).not.toBeNull();
  });

  it('does not set refreshed_at on create when no description', () => {
    const id = upsertCluster({ name: 'No desc' });

    const cluster = getClusterById(id);
    expect(cluster!.refreshedAt).toBeNull();
  });

  it('updates only the description field (partial update)', () => {
    const id = upsertCluster({ id: 'partial-1', name: 'Original', description: 'Old' });

    upsertCluster({ id: 'partial-1', description: 'Updated desc' });

    const cluster = getClusterById(id);
    expect(cluster!.name).toBe('Original'); // unchanged
    expect(cluster!.description).toBe('Updated desc');
  });

  it('updates only the centroid field (partial update)', () => {
    const id = upsertCluster({ id: 'partial-2', name: 'Has Name', centroid: [0.1, 0.2] });

    upsertCluster({ id: 'partial-2', centroid: [0.9, 0.8] });

    const cluster = getClusterById(id);
    expect(cluster!.name).toBe('Has Name'); // unchanged
    expect(cluster!.centroid![0]).toBeCloseTo(0.9);
    expect(cluster!.centroid![1]).toBeCloseTo(0.8);
  });

  it('updates only the name field (partial update)', () => {
    const id = upsertCluster({
      id: 'partial-3',
      name: 'Old Name',
      description: 'Desc',
      membershipHash: 'hash1',
    });

    upsertCluster({ id: 'partial-3', name: 'New Name' });

    const cluster = getClusterById(id);
    expect(cluster!.name).toBe('New Name');
    expect(cluster!.description).toBe('Desc'); // unchanged
    expect(cluster!.membershipHash).toBe('hash1'); // unchanged
  });

  it('does not modify fields when undefined is passed in update', () => {
    upsertCluster({
      id: 'preserve-1',
      name: 'Keep',
      description: 'Also keep',
      centroid: [1.0, 2.0],
      exemplarIds: ['ex-1'],
      membershipHash: 'hash-keep',
    });

    // Update with only name — all other fields should be preserved
    upsertCluster({ id: 'preserve-1', name: 'Changed' });

    const cluster = getClusterById('preserve-1');
    expect(cluster!.name).toBe('Changed');
    expect(cluster!.description).toBe('Also keep');
    expect(cluster!.centroid).not.toBeNull();
    expect(cluster!.centroid![0]).toBeCloseTo(1.0);
    expect(cluster!.exemplarIds).toEqual(['ex-1']);
    expect(cluster!.membershipHash).toBe('hash-keep');
  });

  it('updates refreshed_at when description changes', () => {
    upsertCluster({ id: 'refresh-1', name: 'Test' });
    const before = getClusterById('refresh-1');
    expect(before!.refreshedAt).toBeNull();

    upsertCluster({ id: 'refresh-1', description: 'Now has desc' });
    const after = getClusterById('refresh-1');
    expect(after!.refreshedAt).not.toBeNull();
  });

  it('does not update refreshed_at when only name changes', () => {
    upsertCluster({ id: 'refresh-2', name: 'Original', description: 'Desc' });
    const before = getClusterById('refresh-2');
    const originalRefreshedAt = before!.refreshedAt;

    // Tiny delay isn't needed since we only check it didn't change
    upsertCluster({ id: 'refresh-2', name: 'New Name' });
    const after = getClusterById('refresh-2');
    expect(after!.refreshedAt).toBe(originalRefreshedAt);
  });

  it('handles empty update gracefully (no fields provided)', () => {
    upsertCluster({ id: 'empty-update', name: 'Original' });

    // Updating with only id and no other fields
    upsertCluster({ id: 'empty-update' });

    const cluster = getClusterById('empty-update');
    expect(cluster!.name).toBe('Original'); // unchanged
  });

  it('updates exemplarIds field', () => {
    upsertCluster({ id: 'exemplar-up', exemplarIds: ['a', 'b'] });

    upsertCluster({ id: 'exemplar-up', exemplarIds: ['c', 'd', 'e'] });

    const cluster = getClusterById('exemplar-up');
    expect(cluster!.exemplarIds).toEqual(['c', 'd', 'e']);
  });

  it('updates membershipHash field', () => {
    upsertCluster({ id: 'hash-up', membershipHash: 'old-hash' });

    upsertCluster({ id: 'hash-up', membershipHash: 'new-hash' });

    const cluster = getClusterById('hash-up');
    expect(cluster!.membershipHash).toBe('new-hash');
  });
});

describe('getStaleClusters (via store function)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('returns clusters with NULL refreshed_at', () => {
    upsertCluster({ id: 'stale-null', name: 'No refresh' });
    upsertCluster({ id: 'fresh', name: 'Refreshed', description: 'Has desc' });

    const stale = getStaleClusters();

    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe('stale-null');
  });

  it('returns clusters older than maxAge', () => {
    // Insert a cluster with an old refreshed_at via raw SQL
    db.prepare(
      `INSERT INTO clusters (id, name, refreshed_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run('old-cluster', 'Old', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

    // Insert a fresh cluster
    upsertCluster({ id: 'fresh-cluster', description: 'Just refreshed' });

    // maxAge = 1 hour
    const stale = getStaleClusters(60 * 60 * 1000);

    const staleIds = stale.map((c) => c.id);
    expect(staleIds).toContain('old-cluster');
    expect(staleIds).not.toContain('fresh-cluster');
  });

  it('returns combined: some null, some old, some fresh', () => {
    // Null refreshed_at
    upsertCluster({ id: 'null-refresh', name: 'Null' });

    // Old refreshed_at
    db.prepare(
      `INSERT INTO clusters (id, name, refreshed_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run('old-refresh', 'Old', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

    // Fresh
    upsertCluster({ id: 'fresh-refresh', description: 'Just done' });

    const stale = getStaleClusters(60 * 60 * 1000);
    const staleIds = stale.map((c) => c.id);

    expect(staleIds).toContain('null-refresh');
    expect(staleIds).toContain('old-refresh');
    expect(staleIds).not.toContain('fresh-refresh');
  });

  it('returns all null-refreshed clusters when no maxAge specified', () => {
    upsertCluster({ id: 'null-1', name: 'A' });
    upsertCluster({ id: 'null-2', name: 'B' });
    upsertCluster({ id: 'fresh-1', description: 'Has desc' });

    const stale = getStaleClusters();
    const staleIds = stale.map((c) => c.id);

    expect(staleIds).toContain('null-1');
    expect(staleIds).toContain('null-2');
    // Without maxAge, only NULL refreshed_at are returned, not old ones
    expect(staleIds).not.toContain('fresh-1');
  });

  it('returns empty array when all clusters are fresh', () => {
    upsertCluster({ id: 'f1', description: 'Fresh 1' });
    upsertCluster({ id: 'f2', description: 'Fresh 2' });

    const stale = getStaleClusters(60 * 60 * 1000);
    expect(stale).toEqual([]);
  });
});

describe('getClusterProjectRelevance (additional cases)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('handles single project with 100% relevance', () => {
    insertTestCluster(db, { id: 'c1' });
    insertTestChunk(db, createSampleChunk({ id: 'ch1', sessionSlug: 'only-project' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2', sessionSlug: 'only-project' }));
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch2', 'c1', 0.2);

    const results = getClusterProjectRelevance(['c1'], 'only-project');

    expect(results).toHaveLength(1);
    expect(results[0].relevance).toBeCloseTo(1.0);
  });

  it('returns empty when cluster ids do not match any assignments', () => {
    insertTestCluster(db, { id: 'c1' });
    // No assignments at all

    const results = getClusterProjectRelevance(['c1'], 'my-project');
    expect(results).toEqual([]);
  });

  it('handles multiple clusters with multiple projects', () => {
    insertTestCluster(db, { id: 'c1' });
    insertTestCluster(db, { id: 'c2' });
    insertTestCluster(db, { id: 'c3' });

    // c1: 1 of 2 from project-a
    insertTestChunk(db, createSampleChunk({ id: 'ch1', sessionSlug: 'project-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2', sessionSlug: 'project-b' }));
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch2', 'c1', 0.2);

    // c2: 3 of 3 from project-a
    insertTestChunk(db, createSampleChunk({ id: 'ch3', sessionSlug: 'project-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch4', sessionSlug: 'project-a' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch5', sessionSlug: 'project-a' }));
    assignChunkToCluster(db, 'ch3', 'c2', 0.1);
    assignChunkToCluster(db, 'ch4', 'c2', 0.2);
    assignChunkToCluster(db, 'ch5', 'c2', 0.3);

    // c3: 0 from project-a
    insertTestChunk(db, createSampleChunk({ id: 'ch6', sessionSlug: 'project-b' }));
    assignChunkToCluster(db, 'ch6', 'c3', 0.1);

    const results = getClusterProjectRelevance(['c1', 'c2', 'c3'], 'project-a');

    expect(results).toHaveLength(2); // c3 excluded (0 project-a chunks)
    // Sorted by relevance desc: c2 (1.0) > c1 (0.5)
    expect(results[0].clusterId).toBe('c2');
    expect(results[0].relevance).toBeCloseTo(1.0);
    expect(results[1].clusterId).toBe('c1');
    expect(results[1].relevance).toBeCloseTo(0.5);
  });
});

describe('assignChunksToClusters (via store function)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('batch-inserts multiple assignments', () => {
    insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch3' }));
    insertTestCluster(db, { id: 'c1' });
    insertTestCluster(db, { id: 'c2' });

    assignChunksToClusters([
      { chunkId: 'ch1', clusterId: 'c1', distance: 0.1 },
      { chunkId: 'ch2', clusterId: 'c1', distance: 0.2 },
      { chunkId: 'ch3', clusterId: 'c2', distance: 0.3 },
    ]);

    const c1Chunks = getClusterChunkIds('c1');
    expect(c1Chunks).toHaveLength(2);
    expect(c1Chunks).toContain('ch1');
    expect(c1Chunks).toContain('ch2');

    const c2Chunks = getClusterChunkIds('c2');
    expect(c2Chunks).toEqual(['ch3']);
  });

  it('handles empty assignments array', () => {
    // Should not throw
    assignChunksToClusters([]);

    const count = getClusterCount();
    expect(count).toBe(0);
  });

  it('replaces existing assignments via INSERT OR REPLACE', () => {
    insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
    insertTestCluster(db, { id: 'c1' });

    assignChunksToClusters([{ chunkId: 'ch1', clusterId: 'c1', distance: 0.5 }]);

    let assignments = getChunkClusterAssignments('ch1');
    expect(assignments[0].distance).toBeCloseTo(0.5);

    // Replace with new distance
    assignChunksToClusters([{ chunkId: 'ch1', clusterId: 'c1', distance: 0.1 }]);

    assignments = getChunkClusterAssignments('ch1');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].distance).toBeCloseTo(0.1);
  });
});

describe('deleteCluster (via store function)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('deletes cluster and its assignments', () => {
    insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
    insertTestChunk(db, createSampleChunk({ id: 'ch2' }));
    insertTestCluster(db, { id: 'c1', name: 'To Delete' });
    assignChunkToCluster(db, 'ch1', 'c1', 0.3);
    assignChunkToCluster(db, 'ch2', 'c1', 0.5);

    const result = deleteCluster('c1');

    expect(result).toBe(true);
    expect(getClusterById('c1')).toBeNull();

    const chunkIds = getClusterChunkIds('c1');
    expect(chunkIds).toEqual([]);
  });

  it('returns false for non-existent cluster', () => {
    const result = deleteCluster('does-not-exist');
    expect(result).toBe(false);
  });

  it('does not affect other clusters', () => {
    insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
    insertTestCluster(db, { id: 'c1' });
    insertTestCluster(db, { id: 'c2' });
    assignChunkToCluster(db, 'ch1', 'c1', 0.1);
    assignChunkToCluster(db, 'ch1', 'c2', 0.2);

    deleteCluster('c1');

    expect(getClusterById('c2')).not.toBeNull();
    const c2Assignments = getChunkClusterAssignments('ch1');
    expect(c2Assignments).toHaveLength(1);
    expect(c2Assignments[0].clusterId).toBe('c2');
  });
});

describe('computeMembershipHash', () => {
  it('returns deterministic hash for same membership', () => {
    const hash1 = computeMembershipHash(['a', 'b', 'c']);
    const hash2 = computeMembershipHash(['a', 'b', 'c']);

    expect(hash1).toBe(hash2);
  });

  it('returns same hash regardless of input order', () => {
    const hash1 = computeMembershipHash(['c', 'a', 'b']);
    const hash2 = computeMembershipHash(['b', 'c', 'a']);
    const hash3 = computeMembershipHash(['a', 'b', 'c']);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('returns different hash for different membership', () => {
    const hash1 = computeMembershipHash(['a', 'b', 'c']);
    const hash2 = computeMembershipHash(['a', 'b', 'd']);

    expect(hash1).not.toBe(hash2);
  });

  it('returns different hash when a member is added', () => {
    const hash1 = computeMembershipHash(['a', 'b']);
    const hash2 = computeMembershipHash(['a', 'b', 'c']);

    expect(hash1).not.toBe(hash2);
  });

  it('returns different hash when a member is removed', () => {
    const hash1 = computeMembershipHash(['a', 'b', 'c']);
    const hash2 = computeMembershipHash(['a', 'c']);

    expect(hash1).not.toBe(hash2);
  });

  it('handles empty membership', () => {
    const hash = computeMembershipHash([]);
    expect(typeof hash).toBe('string');
    // Empty input produces empty base64 string
    expect(hash).toBe('');
  });

  it('handles single member', () => {
    const hash = computeMembershipHash(['only-one']);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe('serialization round-tripping (via store functions)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  it('round-trips Float32Array centroid through upsert and retrieve', () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];

    const id = upsertCluster({ id: 'centroid-rt', centroid: original });
    const cluster = getClusterById(id);

    expect(cluster!.centroid).not.toBeNull();
    expect(cluster!.centroid).toHaveLength(5);
    for (let i = 0; i < original.length; i++) {
      expect(cluster!.centroid![i]).toBeCloseTo(original[i], 5);
    }
  });

  it('round-trips exemplar_ids JSON through upsert and retrieve', () => {
    const exemplars = ['ex-1', 'ex-2', 'ex-3'];

    const id = upsertCluster({ id: 'exemplar-rt', exemplarIds: exemplars });
    const cluster = getClusterById(id);

    expect(cluster!.exemplarIds).toEqual(exemplars);
  });

  it('handles null centroid correctly', () => {
    const id = upsertCluster({ id: 'null-centroid' });
    const cluster = getClusterById(id);

    expect(cluster!.centroid).toBeNull();
  });

  it('handles empty exemplarIds as empty array', () => {
    const id = upsertCluster({ id: 'no-exemplars' });
    const cluster = getClusterById(id);

    expect(cluster!.exemplarIds).toEqual([]);
  });

  it('handles null/undefined optional fields on create', () => {
    const id = upsertCluster({ id: 'all-null' });
    const cluster = getClusterById(id);

    expect(cluster!.name).toBeNull();
    expect(cluster!.description).toBeNull();
    expect(cluster!.centroid).toBeNull();
    expect(cluster!.exemplarIds).toEqual([]);
    expect(cluster!.membershipHash).toBeNull();
    expect(cluster!.refreshedAt).toBeNull();
    expect(cluster!.createdAt).toBeDefined();
  });

  it('preserves centroid precision through update', () => {
    const original = [0.123456789, 0.987654321];

    upsertCluster({ id: 'precision', centroid: [0.5, 0.5] });
    upsertCluster({ id: 'precision', centroid: original });

    const cluster = getClusterById('precision');
    // Float32 has ~7 decimal digits of precision
    expect(cluster!.centroid![0]).toBeCloseTo(original[0], 5);
    expect(cluster!.centroid![1]).toBeCloseTo(original[1], 5);
  });
});

describe('additional store function coverage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  describe('getAllClusters (via store function)', () => {
    it('returns empty array when no clusters exist', () => {
      const clusters = getAllClusters();
      expect(clusters).toEqual([]);
    });

    it('returns all clusters with correct types', () => {
      upsertCluster({ id: 'c1', name: 'First', description: 'Desc 1' });
      upsertCluster({ id: 'c2', name: 'Second' });

      const clusters = getAllClusters();
      expect(clusters).toHaveLength(2);
      expect(clusters[0].id).toBeDefined();
      expect(clusters[0].createdAt).toBeDefined();
    });
  });

  describe('getClusterById (via store function)', () => {
    it('returns null for non-existent cluster', () => {
      const cluster = getClusterById('non-existent');
      expect(cluster).toBeNull();
    });

    it('returns full StoredCluster with all fields', () => {
      upsertCluster({
        id: 'full',
        name: 'Full Cluster',
        description: 'Full description',
        centroid: [0.1, 0.2],
        exemplarIds: ['ex-1'],
        membershipHash: 'hash-full',
      });

      const cluster = getClusterById('full');
      expect(cluster).not.toBeNull();
      expect(cluster!.id).toBe('full');
      expect(cluster!.name).toBe('Full Cluster');
      expect(cluster!.description).toBe('Full description');
      expect(cluster!.centroid).toHaveLength(2);
      expect(cluster!.exemplarIds).toEqual(['ex-1']);
      expect(cluster!.membershipHash).toBe('hash-full');
      expect(cluster!.createdAt).toBeDefined();
      expect(cluster!.refreshedAt).not.toBeNull(); // description triggers refresh
    });
  });

  describe('assignChunkToCluster (via store function)', () => {
    it('creates assignment and retrieves it', () => {
      insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
      upsertCluster({ id: 'c1' });

      assignChunkToClusterFn('ch1', 'c1', 0.42);

      const assignments = getChunkClusterAssignments('ch1');
      expect(assignments).toHaveLength(1);
      expect(assignments[0].chunkId).toBe('ch1');
      expect(assignments[0].clusterId).toBe('c1');
      expect(assignments[0].distance).toBeCloseTo(0.42);
    });
  });

  describe('getClusterChunkIds (via store function)', () => {
    it('returns empty for cluster with no assignments', () => {
      upsertCluster({ id: 'empty-c' });

      const ids = getClusterChunkIds('empty-c');
      expect(ids).toEqual([]);
    });

    it('returns chunk ids sorted by distance', () => {
      insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
      insertTestChunk(db, createSampleChunk({ id: 'ch2' }));
      insertTestChunk(db, createSampleChunk({ id: 'ch3' }));
      upsertCluster({ id: 'c1' });

      assignChunkToClusterFn('ch1', 'c1', 0.5);
      assignChunkToClusterFn('ch2', 'c1', 0.1);
      assignChunkToClusterFn('ch3', 'c1', 0.3);

      const ids = getClusterChunkIds('c1');
      expect(ids).toEqual(['ch2', 'ch3', 'ch1']);
    });
  });

  describe('removeChunkAssignments (via store function)', () => {
    it('removes all assignments for a chunk and returns count', () => {
      insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
      upsertCluster({ id: 'c1' });
      upsertCluster({ id: 'c2' });
      assignChunkToClusterFn('ch1', 'c1', 0.1);
      assignChunkToClusterFn('ch1', 'c2', 0.2);

      const count = removeChunkAssignments('ch1');
      expect(count).toBe(2);

      const assignments = getChunkClusterAssignments('ch1');
      expect(assignments).toEqual([]);
    });

    it('returns 0 when chunk has no assignments', () => {
      const count = removeChunkAssignments('non-existent');
      expect(count).toBe(0);
    });
  });

  describe('clearClusterAssignments (via store function)', () => {
    it('removes all assignments for a cluster and returns count', () => {
      insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
      insertTestChunk(db, createSampleChunk({ id: 'ch2' }));
      upsertCluster({ id: 'c1' });
      assignChunkToClusterFn('ch1', 'c1', 0.1);
      assignChunkToClusterFn('ch2', 'c1', 0.2);

      const count = clearClusterAssignments('c1');
      expect(count).toBe(2);

      const ids = getClusterChunkIds('c1');
      expect(ids).toEqual([]);
    });
  });

  describe('clearAllClusters (via store function)', () => {
    it('removes all clusters and all assignments', () => {
      insertTestChunk(db, createSampleChunk({ id: 'ch1' }));
      upsertCluster({ id: 'c1' });
      upsertCluster({ id: 'c2' });
      assignChunkToClusterFn('ch1', 'c1', 0.1);

      clearAllClusters();

      expect(getAllClusters()).toEqual([]);
      expect(getClusterCount()).toBe(0);
    });
  });

  describe('getClusterCount (via store function)', () => {
    it('returns 0 for empty database', () => {
      expect(getClusterCount()).toBe(0);
    });

    it('returns correct count after inserts and deletes', () => {
      upsertCluster({ id: 'c1' });
      upsertCluster({ id: 'c2' });
      upsertCluster({ id: 'c3' });
      expect(getClusterCount()).toBe(3);

      deleteCluster('c2');
      expect(getClusterCount()).toBe(2);
    });
  });
});
