/**
 * Integration tests for entity store CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  setupTestDb,
  teardownTestDb,
  createSampleChunk,
  insertTestChunk,
} from './test-utils.js';
import {
  resolveEntity,
  insertEntityMention,
  getChunkIdsForEntity,
  findEntitiesByAlias,
  getEntitiesForChunk,
  getEntityCount,
} from '../../src/storage/entity-store.js';

describe('entity-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
  });

  afterEach(() => {
    teardownTestDb(db);
  });

  describe('resolveEntity', () => {
    it('creates a new entity on first resolve', () => {
      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      expect(entityId).toBeDefined();
      expect(typeof entityId).toBe('string');
      expect(getEntityCount('test-project')).toBe(1);
    });

    it('returns same entity ID for same alias', () => {
      const id1 = resolveEntity('joel', 'person', '@joel', 'test-project');
      const id2 = resolveEntity('joel', 'person', '@joel', 'test-project');
      expect(id1).toBe(id2);
    });

    it('creates separate entities for different types', () => {
      const personId = resolveEntity('alice', 'person', '@alice', 'test-project');
      const channelId = resolveEntity('alice', 'channel', '#alice', 'test-project');
      expect(personId).not.toBe(channelId);
      expect(getEntityCount('test-project')).toBe(2);
    });

    it('creates separate entities for different projects', () => {
      const id1 = resolveEntity('joel', 'person', '@joel', 'project-a');
      const id2 = resolveEntity('joel', 'person', '@joel', 'project-b');
      expect(id1).not.toBe(id2);
    });

    it('adds mentionForm as additional alias when different', () => {
      const id1 = resolveEntity('joel', 'person', '@joel', 'test-project');
      const id2 = resolveEntity('joel', 'person', 'Joel', 'test-project');
      expect(id1).toBe(id2);

      // Should be findable by both aliases
      const byJoel = findEntitiesByAlias('joel', 'person', 'test-project');
      expect(byJoel).toHaveLength(1);
      expect(byJoel[0].id).toBe(id1);
    });
  });

  describe('insertEntityMention', () => {
    it('inserts a mention', () => {
      const chunk = createSampleChunk({ id: 'chunk-1', content: '@joel said hello' });
      insertTestChunk(db, chunk);

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);

      const entities = getEntitiesForChunk('chunk-1');
      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe(entityId);
    });

    it('handles re-insertion safely (INSERT OR IGNORE)', () => {
      const chunk = createSampleChunk({ id: 'chunk-1', content: '@joel said hello' });
      insertTestChunk(db, chunk);

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);
      // Should not throw
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);

      const entities = getEntitiesForChunk('chunk-1');
      expect(entities).toHaveLength(1);
    });
  });

  describe('getChunkIdsForEntity', () => {
    it('returns chunk IDs for an entity', () => {
      const chunk1 = createSampleChunk({
        id: 'chunk-1',
        content: '@joel',
        startTime: '2024-01-01T00:00:00Z',
      });
      const chunk2 = createSampleChunk({
        id: 'chunk-2',
        content: '@joel again',
        startTime: '2024-01-02T00:00:00Z',
      });
      insertTestChunk(db, chunk1);
      insertTestChunk(db, chunk2);

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);
      insertEntityMention('chunk-2', entityId, '@joel', 0.95);

      const chunkIds = getChunkIdsForEntity(entityId);
      expect(chunkIds).toHaveLength(2);
      // Ordered by start_time DESC (most recent first)
      expect(chunkIds[0]).toBe('chunk-2');
      expect(chunkIds[1]).toBe('chunk-1');
    });

    it('respects limit parameter', () => {
      // Create 3 chunks
      for (let i = 0; i < 3; i++) {
        const chunk = createSampleChunk({
          id: `chunk-${i}`,
          content: `@joel ${i}`,
          startTime: `2024-01-0${i + 1}T00:00:00Z`,
        });
        insertTestChunk(db, chunk);
      }

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      for (let i = 0; i < 3; i++) {
        insertEntityMention(`chunk-${i}`, entityId, '@joel', 0.95);
      }

      const chunkIds = getChunkIdsForEntity(entityId, 2);
      expect(chunkIds).toHaveLength(2);
    });

    it('returns empty for unknown entity', () => {
      expect(getChunkIdsForEntity('nonexistent')).toEqual([]);
    });
  });

  describe('findEntitiesByAlias', () => {
    it('finds entities by alias', () => {
      resolveEntity('joel', 'person', '@joel', 'test-project');

      const entities = findEntitiesByAlias('joel', 'person', 'test-project');
      expect(entities).toHaveLength(1);
      expect(entities[0].canonicalName).toBe('joel');
      expect(entities[0].entityType).toBe('person');
    });

    it('returns empty for unknown alias', () => {
      const entities = findEntitiesByAlias('unknown', 'person', 'test-project');
      expect(entities).toEqual([]);
    });

    it('scopes by entity type', () => {
      resolveEntity('alice', 'person', '@alice', 'test-project');
      resolveEntity('alice', 'channel', '#alice', 'test-project');

      const people = findEntitiesByAlias('alice', 'person', 'test-project');
      expect(people).toHaveLength(1);
      expect(people[0].entityType).toBe('person');

      const channels = findEntitiesByAlias('alice', 'channel', 'test-project');
      expect(channels).toHaveLength(1);
      expect(channels[0].entityType).toBe('channel');
    });
  });

  describe('getEntitiesForChunk', () => {
    it('returns all entities for a chunk', () => {
      const chunk = createSampleChunk({
        id: 'chunk-1',
        content: '@joel in #general',
      });
      insertTestChunk(db, chunk);

      const joelId = resolveEntity('joel', 'person', '@joel', 'test-project');
      const generalId = resolveEntity('general', 'channel', '#general', 'test-project');
      insertEntityMention('chunk-1', joelId, '@joel', 0.95);
      insertEntityMention('chunk-1', generalId, '#general', 0.95);

      const entities = getEntitiesForChunk('chunk-1');
      expect(entities).toHaveLength(2);
      const types = entities.map((e) => e.entityType).sort();
      expect(types).toEqual(['channel', 'person']);
    });

    it('returns empty for chunk with no entities', () => {
      const chunk = createSampleChunk({ id: 'chunk-1' });
      insertTestChunk(db, chunk);
      expect(getEntitiesForChunk('chunk-1')).toEqual([]);
    });
  });

  describe('getEntityCount', () => {
    it('counts all entities', () => {
      resolveEntity('joel', 'person', '@joel', 'project-a');
      resolveEntity('alice', 'person', '@alice', 'project-b');
      expect(getEntityCount()).toBe(2);
    });

    it('counts entities by project', () => {
      resolveEntity('joel', 'person', '@joel', 'project-a');
      resolveEntity('alice', 'person', '@alice', 'project-b');
      expect(getEntityCount('project-a')).toBe(1);
      expect(getEntityCount('project-b')).toBe(1);
    });

    it('returns 0 when empty', () => {
      expect(getEntityCount()).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('deletes entity mentions when chunk is deleted', () => {
      const chunk = createSampleChunk({ id: 'chunk-1' });
      insertTestChunk(db, chunk);

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);

      // Verify mention exists
      expect(getChunkIdsForEntity(entityId)).toHaveLength(1);

      // Delete chunk — should cascade to entity_mentions
      db.exec("DELETE FROM chunks WHERE id = 'chunk-1'");
      expect(getChunkIdsForEntity(entityId)).toHaveLength(0);
    });

    it('deletes aliases and mentions when entity is deleted', () => {
      const chunk = createSampleChunk({ id: 'chunk-1' });
      insertTestChunk(db, chunk);

      const entityId = resolveEntity('joel', 'person', '@joel', 'test-project');
      insertEntityMention('chunk-1', entityId, '@joel', 0.95);

      // Delete entity — should cascade
      db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);

      expect(findEntitiesByAlias('joel', 'person', 'test-project')).toHaveLength(0);
      expect(getEntitiesForChunk('chunk-1')).toHaveLength(0);
    });
  });
});
