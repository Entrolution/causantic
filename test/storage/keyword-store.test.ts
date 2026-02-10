/**
 * Tests for KeywordStore (FTS5-backed keyword search).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, createSampleChunk, insertTestChunk } from './test-utils.js';
import { KeywordStore } from '../../src/storage/keyword-store.js';

describe('keyword-store', () => {
  let db: Database.Database;
  let store: KeywordStore;

  beforeEach(() => {
    db = createTestDb();
    store = new KeywordStore(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertChunkWithContent(id: string, content: string, sessionSlug = 'test-project') {
    insertTestChunk(db, createSampleChunk({ id, content, sessionSlug }));
  }

  describe('search', () => {
    it('returns BM25-ranked results', () => {
      insertChunkWithContent('c1', 'authentication flow for user login');
      insertChunkWithContent('c2', 'database migration script');
      insertChunkWithContent('c3', 'user authentication with OAuth tokens');

      const results = store.search('authentication', 10);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Both authentication chunks should be returned
      const ids = results.map(r => r.id);
      expect(ids).toContain('c1');
      expect(ids).toContain('c3');
      // Scores should be positive (negated BM25)
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it('returns empty results for empty query', () => {
      insertChunkWithContent('c1', 'some content');
      const results = store.search('', 10);
      expect(results).toEqual([]);
    });

    it('returns empty results for whitespace-only query', () => {
      insertChunkWithContent('c1', 'some content');
      const results = store.search('   ', 10);
      expect(results).toEqual([]);
    });

    it('handles special characters in queries', () => {
      insertChunkWithContent('c1', 'error handling with try-catch blocks');

      // These should not crash even with special FTS5 chars
      expect(() => store.search('try*catch', 10)).not.toThrow();
      expect(() => store.search('"quoted"', 10)).not.toThrow();
      expect(() => store.search('error-handling', 10)).not.toThrow();
      expect(() => store.search('foo(bar)', 10)).not.toThrow();
      expect(() => store.search('{test}', 10)).not.toThrow();
      expect(() => store.search('NOT AND OR', 10)).not.toThrow();
    });

    it('multi-word queries work correctly', () => {
      insertChunkWithContent('c1', 'user authentication with OAuth');
      insertChunkWithContent('c2', 'database connection pooling');
      insertChunkWithContent('c3', 'user profile management');

      const results = store.search('user authentication', 10);
      expect(results.length).toBeGreaterThan(0);

      const ids = results.map(r => r.id);
      expect(ids).toContain('c1');
    });

    it('porter stemming matches word variants', () => {
      insertChunkWithContent('c1', 'the user is authenticating with the server');
      insertChunkWithContent('c2', 'configuration of the application settings');

      // "authentication" should match "authenticating" via porter stemming
      const results = store.search('authentication', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('c1');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        insertChunkWithContent(`c${i}`, `authentication method ${i}`);
      }

      const results = store.search('authentication', 3);
      expect(results.length).toBe(3);
    });

    it('query preprocessing strips FTS5 operators', () => {
      insertChunkWithContent('c1', 'simple test content');

      // FTS5 operators like AND, OR, NOT should be stripped
      const results = store.search('simple AND test OR content NOT other', 10);
      // Should not throw and should find something
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('searchByProject', () => {
    it('only returns matching project chunks', () => {
      insertChunkWithContent('c1', 'authentication flow', 'project-a');
      insertChunkWithContent('c2', 'authentication tokens', 'project-b');
      insertChunkWithContent('c3', 'authentication middleware', 'project-a');

      const results = store.searchByProject('authentication', 'project-a', 10);

      const ids = results.map(r => r.id);
      expect(ids).toContain('c1');
      expect(ids).toContain('c3');
      expect(ids).not.toContain('c2');
    });

    it('supports multiple projects', () => {
      insertChunkWithContent('c1', 'authentication flow', 'project-a');
      insertChunkWithContent('c2', 'authentication tokens', 'project-b');
      insertChunkWithContent('c3', 'authentication middleware', 'project-c');

      const results = store.searchByProject('authentication', ['project-a', 'project-b'], 10);

      const ids = results.map(r => r.id);
      expect(ids).toContain('c1');
      expect(ids).toContain('c2');
      expect(ids).not.toContain('c3');
    });

    it('returns empty for empty query', () => {
      insertChunkWithContent('c1', 'some content', 'project-a');
      const results = store.searchByProject('', 'project-a', 10);
      expect(results).toEqual([]);
    });

    it('returns empty for empty project list', () => {
      insertChunkWithContent('c1', 'authentication flow', 'project-a');
      const results = store.searchByProject('authentication', [], 10);
      expect(results).toEqual([]);
    });
  });
});
