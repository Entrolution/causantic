/**
 * Tests for edge store CRUD operations.
 * These tests use direct database operations to avoid singleton state issues.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, createSampleChunk, insertTestChunk, insertTestEdge } from './test-utils.js';

describe('edge-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Create some chunks to connect with edges
    insertTestChunk(db, createSampleChunk({ id: 'chunk-1' }));
    insertTestChunk(db, createSampleChunk({ id: 'chunk-2' }));
    insertTestChunk(db, createSampleChunk({ id: 'chunk-3' }));
  });

  afterEach(() => {
    db.close();
  });

  describe('createEdge', () => {
    it('creates an edge with all fields', () => {
      insertTestEdge(db, {
        id: 'edge-1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
        referenceType: 'within-chain',
        initialWeight: 0.8,
      });

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge-1') as {
        id: string;
        source_chunk_id: string;
        target_chunk_id: string;
        edge_type: string;
        reference_type: string | null;
        initial_weight: number;
        link_count: number;
      };

      expect(row).toBeDefined();
      expect(row.source_chunk_id).toBe('chunk-1');
      expect(row.target_chunk_id).toBe('chunk-2');
      expect(row.edge_type).toBe('forward');
      expect(row.reference_type).toBe('within-chain');
      expect(row.initial_weight).toBeCloseTo(0.8);
      expect(row.link_count).toBe(1);
    });

    it('creates an edge with null optional fields', () => {
      insertTestEdge(db, {
        id: 'edge-2',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'backward',
      });

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge-2') as {
        reference_type: string | null;
      };

      expect(row.reference_type).toBeNull();
    });
  });

  describe('getEdgeById', () => {
    it('returns null for non-existent edge', () => {
      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('non-existent');
      expect(row).toBeUndefined();
    });

    it('returns the edge when it exists', () => {
      insertTestEdge(db, {
        id: 'edge-1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('edge-1');
      expect(row).toBeDefined();
    });
  });

  describe('getOutgoingEdges', () => {
    it('returns empty array when no edges exist', () => {
      const rows = db.prepare('SELECT * FROM edges WHERE source_chunk_id = ?').all('chunk-1');
      expect(rows).toEqual([]);
    });

    it('returns outgoing edges from a chunk', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e3',
        sourceChunkId: 'chunk-2',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });

      const rows = db.prepare('SELECT * FROM edges WHERE source_chunk_id = ?').all('chunk-1');
      expect(rows.length).toBe(2);
    });

    it('filters by edge type', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-3',
        edgeType: 'backward',
      });

      const forwardEdges = db
        .prepare('SELECT * FROM edges WHERE source_chunk_id = ? AND edge_type = ?')
        .all('chunk-1', 'forward');
      expect(forwardEdges.length).toBe(1);

      const backwardEdges = db
        .prepare('SELECT * FROM edges WHERE source_chunk_id = ? AND edge_type = ?')
        .all('chunk-1', 'backward');
      expect(backwardEdges.length).toBe(1);
    });
  });

  describe('getIncomingEdges', () => {
    it('returns incoming edges to a chunk', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-2',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });

      const rows = db.prepare('SELECT * FROM edges WHERE target_chunk_id = ?').all('chunk-3');
      expect(rows.length).toBe(2);
    });
  });

  describe('getForwardEdges', () => {
    it('returns forward edges from a chunk (source_chunk_id match)', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });

      const rows = db
        .prepare("SELECT * FROM edges WHERE source_chunk_id = ? AND edge_type = 'forward'")
        .all('chunk-1');
      expect(rows.length).toBe(2);
    });

    it('returns empty array when no forward edges exist', () => {
      const rows = db
        .prepare("SELECT * FROM edges WHERE source_chunk_id = ? AND edge_type = 'forward'")
        .all('chunk-1');
      expect(rows).toEqual([]);
    });
  });

  describe('getBackwardEdges', () => {
    it('returns edges pointing to a chunk (target_chunk_id match with forward type)', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-3',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const rows = db
        .prepare("SELECT * FROM edges WHERE target_chunk_id = ? AND edge_type = 'forward'")
        .all('chunk-2');
      expect(rows.length).toBe(2);
    });

    it('returns empty array when no backward edges exist', () => {
      const rows = db
        .prepare("SELECT * FROM edges WHERE target_chunk_id = ? AND edge_type = 'forward'")
        .all('chunk-1');
      expect(rows).toEqual([]);
    });
  });

  describe('edge existence queries', () => {
    it('returns false for chunk with no edges', () => {
      const row = db
        .prepare(
          `
        SELECT 1 FROM edges
        WHERE source_chunk_id = ? OR target_chunk_id = ?
        LIMIT 1
      `,
        )
        .get('chunk-1', 'chunk-1');
      expect(row).toBeUndefined();
    });

    it('returns true for chunk with outgoing edges', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const row = db
        .prepare(
          `
        SELECT 1 FROM edges
        WHERE source_chunk_id = ? OR target_chunk_id = ?
        LIMIT 1
      `,
        )
        .get('chunk-1', 'chunk-1');
      expect(row).toBeDefined();
    });

    it('returns true for chunk with incoming edges', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const row = db
        .prepare(
          `
        SELECT 1 FROM edges
        WHERE source_chunk_id = ? OR target_chunk_id = ?
        LIMIT 1
      `,
        )
        .get('chunk-2', 'chunk-2');
      expect(row).toBeDefined();
    });
  });

  describe('deleteEdge', () => {
    it('deletes an edge', () => {
      insertTestEdge(db, {
        id: 'to-delete',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const result = db.prepare('DELETE FROM edges WHERE id = ?').run('to-delete');
      expect(result.changes).toBe(1);

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('to-delete');
      expect(row).toBeUndefined();
    });

    it('returns 0 changes for non-existent edge', () => {
      const result = db.prepare('DELETE FROM edges WHERE id = ?').run('non-existent');
      expect(result.changes).toBe(0);
    });
  });

  describe('deleteEdgesForChunk', () => {
    it('deletes all edges for a chunk', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-3',
        targetChunkId: 'chunk-1',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e3',
        sourceChunkId: 'chunk-2',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });

      const result = db
        .prepare('DELETE FROM edges WHERE source_chunk_id = ? OR target_chunk_id = ?')
        .run('chunk-1', 'chunk-1');
      expect(result.changes).toBe(2);

      const remaining = db.prepare('SELECT COUNT(*) as count FROM edges').get() as {
        count: number;
      };
      expect(remaining.count).toBe(1);
    });
  });

  describe('getEdgeCount', () => {
    it('returns 0 for empty database', () => {
      const row = db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
      expect(row.count).toBe(0);
    });

    it('returns correct count', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-2',
        targetChunkId: 'chunk-3',
        edgeType: 'forward',
      });

      const row = db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
      expect(row.count).toBe(2);
    });
  });

  describe('unique constraint', () => {
    it('prevents duplicate edges with same source, target, type', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      expect(() => {
        insertTestEdge(db, {
          id: 'e2',
          sourceChunkId: 'chunk-1',
          targetChunkId: 'chunk-2',
          edgeType: 'forward',
        });
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('allows same source/target with different edge type', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });
      insertTestEdge(db, {
        id: 'e2',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'backward',
      });

      const rows = db
        .prepare('SELECT * FROM edges WHERE source_chunk_id = ? AND target_chunk_id = ?')
        .all('chunk-1', 'chunk-2');
      expect(rows.length).toBe(2);
    });
  });

  describe('link count and boosting', () => {
    it('stores link count', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
        linkCount: 5,
      });

      const row = db.prepare('SELECT link_count FROM edges WHERE id = ?').get('e1') as {
        link_count: number;
      };
      expect(row.link_count).toBe(5);
    });

    it('defaults link count to 1', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      const row = db.prepare('SELECT link_count FROM edges WHERE id = ?').get('e1') as {
        link_count: number;
      };
      expect(row.link_count).toBe(1);
    });

    it('can increment link count', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      db.prepare('UPDATE edges SET link_count = link_count + 1 WHERE id = ?').run('e1');

      const row = db.prepare('SELECT link_count FROM edges WHERE id = ?').get('e1') as {
        link_count: number;
      };
      expect(row.link_count).toBe(2);
    });
  });

  describe('reference types', () => {
    const referenceTypes = ['within-chain', 'cross-session', 'brief', 'debrief'];

    for (const refType of referenceTypes) {
      it(`stores ${refType} reference type`, () => {
        insertTestEdge(db, {
          id: `edge-${refType}`,
          sourceChunkId: 'chunk-1',
          targetChunkId: 'chunk-2',
          edgeType: 'forward',
          referenceType: refType,
        });

        const row = db
          .prepare('SELECT reference_type FROM edges WHERE id = ?')
          .get(`edge-${refType}`) as {
          reference_type: string;
        };
        expect(row.reference_type).toBe(refType);
      });
    }
  });

  describe('cascade deletion', () => {
    it('deletes edges when source chunk is deleted', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      db.prepare('DELETE FROM chunks WHERE id = ?').run('chunk-1');

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('e1');
      expect(row).toBeUndefined();
    });

    it('deletes edges when target chunk is deleted', () => {
      insertTestEdge(db, {
        id: 'e1',
        sourceChunkId: 'chunk-1',
        targetChunkId: 'chunk-2',
        edgeType: 'forward',
      });

      db.prepare('DELETE FROM chunks WHERE id = ?').run('chunk-2');

      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('e1');
      expect(row).toBeUndefined();
    });
  });
});
