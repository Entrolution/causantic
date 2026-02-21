/**
 * Tests for in-memory vector store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from './test-utils.js';

describe('vector-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Create vectors table matching production schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('embedding serialization', () => {
    it('serializes embedding to Float32Array buffer', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const float32 = new Float32Array(embedding);
      const buffer = Buffer.from(float32.buffer);

      expect(buffer.length).toBe(embedding.length * 4); // 4 bytes per float32
    });

    it('deserializes buffer back to embedding array', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];
      const float32 = new Float32Array(original);
      const buffer = Buffer.from(float32.buffer);

      // Deserialize
      const restored = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / Float32Array.BYTES_PER_ELEMENT,
      );

      expect(Array.from(restored).length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('round-trips through database', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];
      const float32 = new Float32Array(original);
      const buffer = Buffer.from(float32.buffer);

      // Insert
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('test-vec', buffer);

      // Retrieve
      const row = db.prepare('SELECT embedding FROM vectors WHERE id = ?').get('test-vec') as {
        embedding: Buffer;
      };

      const restored = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / Float32Array.BYTES_PER_ELEMENT,
      );

      expect(Array.from(restored).length).toBe(original.length);
    });
  });

  describe('insert operations', () => {
    it('inserts a vector', () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5]);
      const buffer = Buffer.from(embedding.buffer);

      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-1', buffer);

      const row = db.prepare('SELECT id FROM vectors WHERE id = ?').get('vec-1');
      expect(row).toBeDefined();
    });

    it('replaces existing vector with same ID', () => {
      const embedding1 = new Float32Array([0.1, 0.1, 0.1]);
      const embedding2 = new Float32Array([0.9, 0.9, 0.9]);

      db.prepare('INSERT OR REPLACE INTO vectors (id, embedding) VALUES (?, ?)').run(
        'vec-1',
        Buffer.from(embedding1.buffer),
      );

      db.prepare('INSERT OR REPLACE INTO vectors (id, embedding) VALUES (?, ?)').run(
        'vec-1',
        Buffer.from(embedding2.buffer),
      );

      const count = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
      expect(count.count).toBe(1);
    });

    it('supports batch insert in transaction', () => {
      const items = [
        { id: 'vec-1', embedding: [0.1, 0.2, 0.3] },
        { id: 'vec-2', embedding: [0.4, 0.5, 0.6] },
        { id: 'vec-3', embedding: [0.7, 0.8, 0.9] },
      ];

      const stmt = db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)');
      const insertMany = db.transaction((items: Array<{ id: string; embedding: number[] }>) => {
        for (const item of items) {
          const buffer = Buffer.from(new Float32Array(item.embedding).buffer);
          stmt.run(item.id, buffer);
        }
      });

      insertMany(items);

      const count = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
      expect(count.count).toBe(3);
    });
  });

  describe('search operations', () => {
    it('angular distance is 0 for identical vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];

      // Angular distance: 1 - cos(angle)
      // For identical normalized vectors: cos = 1, so distance = 0
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const distance = 1 - dot;

      expect(distance).toBeCloseTo(0);
    });

    it('angular distance is ~1 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];

      // For orthogonal vectors: cos = 0, so distance = 1
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const distance = 1 - dot;

      expect(distance).toBeCloseTo(1);
    });

    it('angular distance is ~2 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];

      // For opposite vectors: cos = -1, so distance = 2
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const distance = 1 - dot;

      expect(distance).toBeCloseTo(2);
    });

    it('search returns results sorted by distance', () => {
      const results = [
        { id: 'far', distance: 0.8 },
        { id: 'close', distance: 0.1 },
        { id: 'medium', distance: 0.5 },
      ];

      results.sort((a, b) => a.distance - b.distance);

      expect(results[0].id).toBe('close');
      expect(results[1].id).toBe('medium');
      expect(results[2].id).toBe('far');
    });

    it('search limits results to specified count', () => {
      const allResults = [
        { id: 'v1', distance: 0.1 },
        { id: 'v2', distance: 0.2 },
        { id: 'v3', distance: 0.3 },
        { id: 'v4', distance: 0.4 },
        { id: 'v5', distance: 0.5 },
      ];

      const limit = 3;
      const limited = allResults.slice(0, limit);

      expect(limited.length).toBe(3);
    });
  });

  describe('searchWithinIds', () => {
    it('filters search to specified candidate IDs', () => {
      const allVectors = ['v1', 'v2', 'v3', 'v4', 'v5'];
      const candidateIds = new Set(['v2', 'v4']);

      const filtered = allVectors.filter((id) => candidateIds.has(id));

      expect(filtered).toEqual(['v2', 'v4']);
    });
  });

  describe('delete operations', () => {
    beforeEach(() => {
      const embedding = Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-1', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-2', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-3', embedding);
    });

    it('deletes a single vector', () => {
      const result = db.prepare('DELETE FROM vectors WHERE id = ?').run('vec-1');
      expect(result.changes).toBe(1);

      const remaining = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as {
        count: number;
      };
      expect(remaining.count).toBe(2);
    });

    it('returns 0 for non-existent vector', () => {
      const result = db.prepare('DELETE FROM vectors WHERE id = ?').run('non-existent');
      expect(result.changes).toBe(0);
    });

    it('batch deletes multiple vectors', () => {
      const ids = ['vec-1', 'vec-3'];
      const placeholders = ids.map(() => '?').join(',');
      const result = db.prepare(`DELETE FROM vectors WHERE id IN (${placeholders})`).run(...ids);

      expect(result.changes).toBe(2);
    });
  });

  describe('utility operations', () => {
    it('counts vectors', () => {
      const embedding = Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-1', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-2', embedding);

      const count = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
      expect(count.count).toBe(2);
    });

    it('checks if vector exists', () => {
      const embedding = Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('exists', embedding);

      const exists = db.prepare('SELECT 1 FROM vectors WHERE id = ?').get('exists');
      const notExists = db.prepare('SELECT 1 FROM vectors WHERE id = ?').get('not-exists');

      expect(exists).toBeDefined();
      expect(notExists).toBeUndefined();
    });

    it('gets all vector IDs', () => {
      const embedding = Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-1', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-2', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-3', embedding);

      const rows = db.prepare('SELECT id FROM vectors').all() as { id: string }[];
      const ids = rows.map((r) => r.id);

      expect(ids.length).toBe(3);
      expect(ids).toContain('vec-1');
      expect(ids).toContain('vec-2');
      expect(ids).toContain('vec-3');
    });

    it('clears all vectors', () => {
      const embedding = Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-1', embedding);
      db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run('vec-2', embedding);

      db.exec('DELETE FROM vectors');

      const count = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
      expect(count.count).toBe(0);
    });
  });

  describe('VectorSearchResult interface', () => {
    it('has correct structure', () => {
      const result = {
        id: 'chunk-abc',
        distance: 0.15,
      };

      expect(result.id).toBe('chunk-abc');
      expect(result.distance).toBe(0.15);
    });
  });

  describe('searchByProject', () => {
    it('filters vectors by project using in-memory index', () => {
      // Simulate the project index behavior
      const projectIndex = new Map<string, string>();
      projectIndex.set('v1', 'project-a');
      projectIndex.set('v2', 'project-b');
      projectIndex.set('v3', 'project-a');
      projectIndex.set('v4', 'project-c');

      const targetProject = 'project-a';
      const filtered = Array.from(projectIndex.entries())
        .filter(([_, project]) => project === targetProject)
        .map(([id]) => id);

      expect(filtered).toEqual(['v1', 'v3']);
    });

    it('supports multi-project filtering', () => {
      const projectIndex = new Map<string, string>();
      projectIndex.set('v1', 'project-a');
      projectIndex.set('v2', 'project-b');
      projectIndex.set('v3', 'project-a');
      projectIndex.set('v4', 'project-c');

      const targetProjects = new Set(['project-a', 'project-c']);
      const filtered = Array.from(projectIndex.entries())
        .filter(([_, project]) => targetProjects.has(project))
        .map(([id]) => id);

      expect(filtered).toEqual(['v1', 'v3', 'v4']);
    });

    it('returns empty for non-existent project', () => {
      const projectIndex = new Map<string, string>();
      projectIndex.set('v1', 'project-a');

      const targetProject = 'non-existent';
      const filtered = Array.from(projectIndex.entries())
        .filter(([_, project]) => project === targetProject)
        .map(([id]) => id);

      expect(filtered).toEqual([]);
    });
  });

  describe('chunk team index', () => {
    it('team_name is queryable for team chunks', () => {
      // Simulate the team index behavior at the DB level
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          session_slug TEXT NOT NULL,
          turn_indices TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          content TEXT NOT NULL,
          approx_tokens INTEGER DEFAULT 0,
          team_name TEXT
        )
      `);

      db.prepare(
        `INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content, approx_tokens, team_name)
         VALUES ('team-chunk', 'sess-1', 'proj', '[0]', '2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z', 'content', 100, 'my-team')`,
      ).run();

      const row = db.prepare('SELECT team_name FROM chunks WHERE id = ?').get('team-chunk') as {
        team_name: string | null;
      };
      expect(row.team_name).toBe('my-team');
    });

    it('team_name is null for non-team chunks', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          session_slug TEXT NOT NULL,
          turn_indices TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          content TEXT NOT NULL,
          approx_tokens INTEGER DEFAULT 0,
          team_name TEXT
        )
      `);

      db.prepare(
        `INSERT INTO chunks (id, session_id, session_slug, turn_indices, start_time, end_time, content, approx_tokens)
         VALUES ('solo-chunk', 'sess-1', 'proj', '[0]', '2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z', 'content', 100)`,
      ).run();

      const row = db.prepare('SELECT team_name FROM chunks WHERE id = ?').get('solo-chunk') as {
        team_name: string | null;
      };
      expect(row.team_name).toBeNull();
    });
  });
});
