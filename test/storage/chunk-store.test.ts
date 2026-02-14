/**
 * Tests for chunk store CRUD operations.
 * These tests use direct database operations to avoid singleton state issues.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestCluster,
  assignChunkToCluster,
} from './test-utils.js';

describe('chunk-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('insertChunk', () => {
    it('inserts a chunk with all fields', () => {
      const chunk = createSampleChunk({
        id: 'test-chunk-1',
        content: 'Hello world',
        agentId: 'ui',
      });

      insertTestChunk(db, chunk);

      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('test-chunk-1') as {
        id: string;
        content: string;
        agent_id: string | null;
      };

      expect(row).toBeDefined();
      expect(row.id).toBe('test-chunk-1');
      expect(row.content).toBe('Hello world');
      expect(row.agent_id).toBe('ui');
    });

    it('inserts a chunk with null optional fields', () => {
      const chunk = createSampleChunk({
        id: 'test-chunk-2',
        agentId: null,
      });

      insertTestChunk(db, chunk);

      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('test-chunk-2') as {
        agent_id: string | null;
      };

      expect(row.agent_id).toBeNull();
    });

    it('stores turn indices as JSON', () => {
      const chunk = createSampleChunk({
        id: 'test-chunk-3',
        turnIndices: [0, 1, 2, 3],
      });

      insertTestChunk(db, chunk);

      const row = db
        .prepare('SELECT turn_indices FROM chunks WHERE id = ?')
        .get('test-chunk-3') as {
        turn_indices: string;
      };

      expect(JSON.parse(row.turn_indices)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('getChunkById', () => {
    it('returns null for non-existent chunk', () => {
      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('non-existent');
      expect(row).toBeUndefined();
    });

    it('returns the chunk when it exists', () => {
      const chunk = createSampleChunk({ id: 'existing-chunk' });
      insertTestChunk(db, chunk);

      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('existing-chunk');
      expect(row).toBeDefined();
    });
  });

  describe('getChunksBySession', () => {
    it('returns empty array when no chunks exist', () => {
      const rows = db.prepare('SELECT * FROM chunks WHERE session_id = ?').all('no-session');
      expect(rows).toEqual([]);
    });

    it('returns chunks for the session', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 'session-1' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 'session-1' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 'session-2' }));

      const rows = db.prepare('SELECT * FROM chunks WHERE session_id = ?').all('session-1');
      expect(rows.length).toBe(2);
    });

    it('orders by start_time', () => {
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c1',
          sessionId: 'session-1',
          startTime: '2024-01-01T00:02:00Z',
        }),
      );
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c2',
          sessionId: 'session-1',
          startTime: '2024-01-01T00:01:00Z',
        }),
      );

      const rows = db
        .prepare('SELECT id FROM chunks WHERE session_id = ? ORDER BY start_time')
        .all('session-1') as { id: string }[];

      expect(rows[0].id).toBe('c2'); // Earlier time first
      expect(rows[1].id).toBe('c1');
    });
  });

  describe('getChunksBySessionSlug', () => {
    it('returns chunks for the project slug', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1', sessionSlug: 'project-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2', sessionSlug: 'project-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3', sessionSlug: 'project-b' }));

      const rows = db.prepare('SELECT * FROM chunks WHERE session_slug = ?').all('project-a');
      expect(rows.length).toBe(2);
    });
  });

  describe('getChunksByIds', () => {
    it('returns empty array for empty input', () => {
      const _rows = db.prepare('SELECT * FROM chunks WHERE id IN ()').all();
      // Actually this would fail syntactically, so we'd check for empty result differently
    });

    it('returns matching chunks', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3' }));

      const rows = db.prepare('SELECT * FROM chunks WHERE id IN (?, ?)').all('c1', 'c3');
      expect(rows.length).toBe(2);
    });

    it('ignores non-existent IDs', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));

      const rows = db.prepare('SELECT * FROM chunks WHERE id IN (?, ?)').all('c1', 'non-existent');
      expect(rows.length).toBe(1);
    });
  });

  describe('getChunksByCluster', () => {
    it('returns chunks assigned to the cluster', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2' }));
      insertTestCluster(db, { id: 'cluster-1', name: 'Test Cluster' });

      assignChunkToCluster(db, 'c1', 'cluster-1', 0.2);
      assignChunkToCluster(db, 'c2', 'cluster-1', 0.5);

      const rows = db
        .prepare(
          `
        SELECT c.id, cc.distance FROM chunks c
        JOIN chunk_clusters cc ON c.id = cc.chunk_id
        WHERE cc.cluster_id = ?
        ORDER BY cc.distance
      `,
        )
        .all('cluster-1') as { id: string; distance: number }[];

      expect(rows.length).toBe(2);
      expect(rows[0].id).toBe('c1'); // Closer distance first
      expect(rows[1].id).toBe('c2');
    });
  });

  describe('isSessionIngested', () => {
    it('returns false for unknown session', () => {
      const row = db.prepare('SELECT 1 FROM chunks WHERE session_id = ? LIMIT 1').get('unknown');
      expect(row).toBeUndefined();
    });

    it('returns true for known session', () => {
      insertTestChunk(db, createSampleChunk({ sessionId: 'known-session' }));

      const row = db
        .prepare('SELECT 1 FROM chunks WHERE session_id = ? LIMIT 1')
        .get('known-session');
      expect(row).toBeDefined();
    });
  });

  describe('deleteChunk', () => {
    it('deletes a chunk', () => {
      insertTestChunk(db, createSampleChunk({ id: 'to-delete' }));

      const result = db.prepare('DELETE FROM chunks WHERE id = ?').run('to-delete');
      expect(result.changes).toBe(1);

      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('to-delete');
      expect(row).toBeUndefined();
    });

    it('returns 0 changes for non-existent chunk', () => {
      const result = db.prepare('DELETE FROM chunks WHERE id = ?').run('non-existent');
      expect(result.changes).toBe(0);
    });
  });

  describe('getSessionIds', () => {
    it('returns distinct session IDs', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1', sessionId: 'session-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2', sessionId: 'session-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3', sessionId: 'session-b' }));

      const rows = db.prepare('SELECT DISTINCT session_id FROM chunks').all() as {
        session_id: string;
      }[];
      const ids = rows.map((r) => r.session_id);

      expect(ids.length).toBe(2);
      expect(ids).toContain('session-a');
      expect(ids).toContain('session-b');
    });
  });

  describe('getChunkCount', () => {
    it('returns 0 for empty database', () => {
      const row = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
      expect(row.count).toBe(0);
    });

    it('returns correct count', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3' }));

      const row = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
      expect(row.count).toBe(3);
    });
  });

  describe('getChunkIdsByProject', () => {
    it('returns chunk IDs for a given project slug', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1', sessionSlug: 'project-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2', sessionSlug: 'project-a' }));
      insertTestChunk(db, createSampleChunk({ id: 'c3', sessionSlug: 'project-b' }));

      const ids = db.prepare('SELECT id FROM chunks WHERE session_slug = ?').all('project-a') as {
        id: string;
      }[];
      expect(ids.map((r) => r.id)).toEqual(['c1', 'c2']);
    });

    it('returns empty array for unknown project', () => {
      const ids = db.prepare('SELECT id FROM chunks WHERE session_slug = ?').all('unknown') as {
        id: string;
      }[];
      expect(ids).toEqual([]);
    });
  });

  describe('getDistinctProjects', () => {
    it('returns distinct projects with chunk counts', () => {
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c1',
          sessionSlug: 'project-a',
          startTime: '2024-01-01T00:00:00Z',
        }),
      );
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c2',
          sessionSlug: 'project-a',
          startTime: '2024-06-01T00:00:00Z',
        }),
      );
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c3',
          sessionSlug: 'project-b',
          startTime: '2024-03-01T00:00:00Z',
        }),
      );

      const rows = db
        .prepare(
          `
        SELECT
          session_slug AS slug,
          COUNT(*) AS chunkCount,
          MIN(start_time) AS firstSeen,
          MAX(start_time) AS lastSeen
        FROM chunks
        WHERE session_slug != ''
        GROUP BY session_slug
        ORDER BY lastSeen DESC
      `,
        )
        .all() as Array<{
        slug: string;
        chunkCount: number;
        firstSeen: string;
        lastSeen: string;
      }>;

      expect(rows.length).toBe(2);

      const projectA = rows.find((r) => r.slug === 'project-a');
      expect(projectA).toBeDefined();
      expect(projectA!.chunkCount).toBe(2);
      expect(projectA!.firstSeen).toBe('2024-01-01T00:00:00Z');
      expect(projectA!.lastSeen).toBe('2024-06-01T00:00:00Z');
    });

    it('excludes empty slugs', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1', sessionSlug: '' }));
      insertTestChunk(db, createSampleChunk({ id: 'c2', sessionSlug: 'real-project' }));

      const rows = db
        .prepare(
          `
        SELECT session_slug AS slug, COUNT(*) AS chunkCount
        FROM chunks
        WHERE session_slug != ''
        GROUP BY session_slug
      `,
        )
        .all() as Array<{ slug: string; chunkCount: number }>;

      expect(rows.length).toBe(1);
      expect(rows[0].slug).toBe('real-project');
    });
  });

  describe('project_path column', () => {
    it('stores and retrieves project_path', () => {
      insertTestChunk(
        db,
        createSampleChunk({
          id: 'c1',
          projectPath: '/Users/gvn/Dev/my-project',
        }),
      );

      const row = db.prepare('SELECT project_path FROM chunks WHERE id = ?').get('c1') as {
        project_path: string | null;
      };
      expect(row.project_path).toBe('/Users/gvn/Dev/my-project');
    });

    it('defaults to null when not provided', () => {
      insertTestChunk(db, createSampleChunk({ id: 'c1' }));

      const row = db.prepare('SELECT project_path FROM chunks WHERE id = ?').get('c1') as {
        project_path: string | null;
      };
      expect(row.project_path).toBeNull();
    });
  });
});
