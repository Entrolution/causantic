/**
 * Tests for vector clock persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb } from './test-utils.js';

describe('clock-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('getReferenceClock', () => {
    it('returns empty object for non-existent project', () => {
      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ? AND project_slug = ?'
      ).get('project:unknown', 'unknown');
      expect(row).toBeUndefined();
    });

    it('returns stored clock when it exists', () => {
      const clock = { ui: 10, human: 5 };

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify(clock));

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('project:test-project') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(clock);
    });
  });

  describe('setReferenceClock', () => {
    it('creates a new reference clock', () => {
      const clock = { ui: 5, human: 3 };

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify(clock));

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('project:test-project') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(clock);
    });

    it('updates existing reference clock', () => {
      // Insert initial
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify({ ui: 1 }));

      // Update
      const newClock = { ui: 10, human: 5 };
      db.prepare(`
        UPDATE vector_clocks SET clock_data = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(newClock), 'project:test-project');

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('project:test-project') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(newClock);
    });

    it('uses upsert for atomic insert/update', () => {
      const clock1 = { ui: 5 };
      const clock2 = { ui: 10, human: 3 };

      // Insert
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          clock_data = excluded.clock_data,
          updated_at = datetime('now')
      `).run('project:test-project', 'test-project', JSON.stringify(clock1));

      // Upsert (should update)
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          clock_data = excluded.clock_data,
          updated_at = datetime('now')
      `).run('project:test-project', 'test-project', JSON.stringify(clock2));

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('project:test-project') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(clock2);
    });
  });

  describe('getAgentClock', () => {
    it('returns empty object for non-existent agent', () => {
      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('agent:test-project:unknown');
      expect(row).toBeUndefined();
    });

    it('returns stored agent clock', () => {
      const clock = { ui: 3, human: 2 };

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:test-project:ui', 'test-project', JSON.stringify(clock));

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('agent:test-project:ui') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(clock);
    });
  });

  describe('updateAgentClock', () => {
    it('stores agent clock', () => {
      const clock = { ui: 5, human: 3 };

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:test-project:ui', 'test-project', JSON.stringify(clock));

      const row = db.prepare(
        'SELECT clock_data FROM vector_clocks WHERE id = ?'
      ).get('agent:test-project:ui') as { clock_data: string };

      expect(JSON.parse(row.clock_data)).toEqual(clock);
    });
  });

  describe('getAllAgentClocks', () => {
    it('returns empty map when no agents exist', () => {
      const rows = db.prepare(
        'SELECT id, clock_data FROM vector_clocks WHERE project_slug = ? AND id LIKE ?'
      ).all('test-project', 'agent:test-project:%');
      expect(rows).toEqual([]);
    });

    it('returns all agent clocks for a project', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:test-project:ui', 'test-project', JSON.stringify({ ui: 5 }));

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:test-project:human', 'test-project', JSON.stringify({ human: 3 }));

      const rows = db.prepare(
        'SELECT id, clock_data FROM vector_clocks WHERE project_slug = ? AND id LIKE ?'
      ).all('test-project', 'agent:test-project:%') as Array<{ id: string; clock_data: string }>;

      expect(rows.length).toBe(2);
    });

    it('does not return clocks from other projects', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:project-a:ui', 'project-a', JSON.stringify({ ui: 5 }));

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:project-b:ui', 'project-b', JSON.stringify({ ui: 3 }));

      const rows = db.prepare(
        'SELECT id, clock_data FROM vector_clocks WHERE project_slug = ? AND id LIKE ?'
      ).all('project-a', 'agent:project-a:%');

      expect(rows.length).toBe(1);
    });
  });

  describe('deleteProjectClocks', () => {
    it('deletes all clocks for a project', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify({ ui: 10 }));

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:test-project:ui', 'test-project', JSON.stringify({ ui: 5 }));

      const result = db.prepare('DELETE FROM vector_clocks WHERE project_slug = ?').run('test-project');
      expect(result.changes).toBe(2);

      const remaining = db.prepare('SELECT * FROM vector_clocks WHERE project_slug = ?').all('test-project');
      expect(remaining).toEqual([]);
    });

    it('does not affect other projects', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:project-a', 'project-a', JSON.stringify({ ui: 10 }));

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:project-b', 'project-b', JSON.stringify({ ui: 5 }));

      db.prepare('DELETE FROM vector_clocks WHERE project_slug = ?').run('project-a');

      const remaining = db.prepare('SELECT * FROM vector_clocks').all();
      expect(remaining.length).toBe(1);
    });
  });

  describe('getClockUpdateTime', () => {
    it('returns null for non-existent clock', () => {
      const row = db.prepare('SELECT updated_at FROM vector_clocks WHERE id = ?').get('project:unknown');
      expect(row).toBeUndefined();
    });

    it('returns timestamp for existing clock', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify({ ui: 5 }));

      const row = db.prepare('SELECT updated_at FROM vector_clocks WHERE id = ?').get('project:test-project') as {
        updated_at: string;
      };

      expect(row.updated_at).toBeDefined();
      expect(typeof row.updated_at).toBe('string');
    });
  });

  describe('hasProjectClocks', () => {
    it('returns false for project without clocks', () => {
      const row = db.prepare('SELECT 1 FROM vector_clocks WHERE project_slug = ? LIMIT 1').get('unknown');
      expect(row).toBeUndefined();
    });

    it('returns true for project with clocks', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test-project', 'test-project', JSON.stringify({ ui: 5 }));

      const row = db.prepare('SELECT 1 FROM vector_clocks WHERE project_slug = ? LIMIT 1').get('test-project');
      expect(row).toBeDefined();
    });
  });

  describe('ID patterns', () => {
    it('uses project: prefix for reference clocks', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:my-project', 'my-project', JSON.stringify({}));

      const row = db.prepare('SELECT id FROM vector_clocks WHERE id LIKE ?').get('project:%');
      expect(row).toBeDefined();
    });

    it('uses agent:project:agentId pattern for agent clocks', () => {
      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('agent:my-project:subagent-1', 'my-project', JSON.stringify({}));

      const row = db.prepare('SELECT id FROM vector_clocks WHERE id LIKE ?').get('agent:%');
      expect(row).toBeDefined();
    });
  });

  describe('clock data serialization', () => {
    it('round-trips complex clock data', () => {
      const complexClock = {
        ui: 100,
        human: 50,
        'subagent-abc123': 25,
        'subagent-def456': 10,
      };

      db.prepare(`
        INSERT INTO vector_clocks (id, project_slug, clock_data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run('project:test', 'test', JSON.stringify(complexClock));

      const row = db.prepare('SELECT clock_data FROM vector_clocks WHERE id = ?').get('project:test') as {
        clock_data: string;
      };

      expect(JSON.parse(row.clock_data)).toEqual(complexClock);
    });
  });

  describe('project_slug index', () => {
    it('index exists for efficient queries', () => {
      const indexes = db.prepare("PRAGMA index_list(vector_clocks)").all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_vector_clocks_project');
    });
  });
});
