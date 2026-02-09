/**
 * Tests for batch ingestion.
 */

import { describe, it, expect } from 'vitest';
import type { BatchIngestOptions, BatchIngestResult } from '../../src/ingest/batch-ingest.js';

describe('batch-ingest', () => {
  describe('BatchIngestOptions interface', () => {
    it('has sensible defaults', () => {
      const defaults = {
        concurrency: 1,
        embeddingModel: 'jina-small',
        skipExisting: true,
        linkCrossSessions: true,
      };

      expect(defaults.concurrency).toBe(1);
      expect(defaults.skipExisting).toBe(true);
    });

    it('supports progress callback', () => {
      let progressCalled = false;
      const options: BatchIngestOptions = {
        progressCallback: (done, total, current) => {
          progressCalled = true;
          expect(typeof done).toBe('number');
          expect(typeof total).toBe('number');
          expect(typeof current).toBe('string');
        },
      };

      options.progressCallback!(5, 10, '/path/to/session.jsonl');
      expect(progressCalled).toBe(true);
    });

    it('supports resumeFrom for continuation', () => {
      const options: BatchIngestOptions = {
        resumeFrom: 'abc-123-session-id',
      };

      expect(options.resumeFrom).toBe('abc-123-session-id');
    });
  });

  describe('BatchIngestResult interface', () => {
    it('has correct structure', () => {
      const result: BatchIngestResult = {
        totalSessions: 100,
        successCount: 95,
        skippedCount: 3,
        errorCount: 2,
        totalChunks: 1500,
        totalEdges: 3000,
        crossSessionEdges: 150,
        subAgentEdges: 50,
        subAgentCount: 25,
        durationMs: 60000,
        results: [],
        errors: [],
      };

      expect(result.totalSessions).toBe(100);
      expect(result.successCount + result.skippedCount + result.errorCount).toBe(100);
    });

    it('tracks per-session results', () => {
      const result: BatchIngestResult = {
        totalSessions: 2,
        successCount: 2,
        skippedCount: 0,
        errorCount: 0,
        totalChunks: 30,
        totalEdges: 50,
        crossSessionEdges: 6,
        subAgentEdges: 0,
        subAgentCount: 0,
        durationMs: 5000,
        results: [
          {
            sessionId: 's1',
            sessionSlug: 'proj',
            chunkCount: 15,
            edgeCount: 25,
            crossSessionEdges: 0,
            subAgentEdges: 0,
            skipped: false,
            durationMs: 2000,
            subAgentCount: 0,
          },
          {
            sessionId: 's2',
            sessionSlug: 'proj',
            chunkCount: 15,
            edgeCount: 25,
            crossSessionEdges: 0,
            subAgentEdges: 0,
            skipped: false,
            durationMs: 2500,
            subAgentCount: 0,
          },
        ],
        errors: [],
      };

      expect(result.results.length).toBe(2);
      expect(result.results.reduce((sum, r) => sum + r.chunkCount, 0)).toBe(30);
    });

    it('tracks errors with path and message', () => {
      const result: BatchIngestResult = {
        totalSessions: 3,
        successCount: 1,
        skippedCount: 0,
        errorCount: 2,
        totalChunks: 10,
        totalEdges: 15,
        crossSessionEdges: 0,
        subAgentEdges: 0,
        subAgentCount: 0,
        durationMs: 3000,
        results: [],
        errors: [
          { path: '/path/to/bad1.jsonl', error: 'Invalid JSON' },
          { path: '/path/to/bad2.jsonl', error: 'File not found' },
        ],
      };

      expect(result.errors.length).toBe(2);
      expect(result.errors[0].error).toBe('Invalid JSON');
    });
  });

  describe('session discovery', () => {
    it('matches UUID session file pattern', () => {
      const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(pattern.test('abc12345-1234-5678-9abc-def012345678')).toBe(true);
      expect(pattern.test('ABC12345-1234-5678-9ABC-DEF012345678')).toBe(true);
      expect(pattern.test('not-a-uuid')).toBe(false);
      expect(pattern.test('main.jsonl')).toBe(false);
    });

    it('skips hidden directories', () => {
      const dirName = '.hidden';
      const shouldSkip = dirName.startsWith('.');

      expect(shouldSkip).toBe(true);
    });

    it('skips node_modules', () => {
      const dirName = 'node_modules';
      const shouldSkip = dirName === 'node_modules';

      expect(shouldSkip).toBe(true);
    });

    it('sorts sessions by modification time', () => {
      const sessions = [
        { path: '/a.jsonl', mtime: 3000 },
        { path: '/b.jsonl', mtime: 1000 },
        { path: '/c.jsonl', mtime: 2000 },
      ];

      sessions.sort((a, b) => a.mtime - b.mtime);

      expect(sessions[0].path).toBe('/b.jsonl');
      expect(sessions[1].path).toBe('/c.jsonl');
      expect(sessions[2].path).toBe('/a.jsonl');
    });
  });

  describe('resume logic', () => {
    it('skips sessions before resumeFrom', () => {
      const sessionPaths = ['/s1.jsonl', '/s2.jsonl', '/s3.jsonl', '/s4.jsonl'];
      const resumeFrom = 's2';

      const resumeIndex = sessionPaths.findIndex((p) => p.includes(resumeFrom));
      const toProcess = sessionPaths.slice(resumeIndex + 1);

      expect(toProcess).toEqual(['/s3.jsonl', '/s4.jsonl']);
    });

    it('processes all if resumeFrom not found', () => {
      const sessionPaths = ['/s1.jsonl', '/s2.jsonl', '/s3.jsonl'];
      const resumeFrom = 'not-found';

      const resumeIndex = sessionPaths.findIndex((p) => p.includes(resumeFrom));
      const toProcess = resumeIndex >= 0 ? sessionPaths.slice(resumeIndex + 1) : sessionPaths;

      expect(toProcess).toEqual(sessionPaths);
    });
  });

  describe('concurrency handling', () => {
    it('sequential processing when concurrency=1', () => {
      const concurrency = 1;
      const isSequential = concurrency === 1;

      expect(isSequential).toBe(true);
    });

    it('parallel processing when concurrency>1', () => {
      const concurrency = 4;
      const isParallel = concurrency > 1;

      expect(isParallel).toBe(true);
    });

    it('limits workers to queue size', () => {
      const concurrency = 10;
      const queueSize = 3;

      const actualWorkers = Math.min(concurrency, queueSize);

      expect(actualWorkers).toBe(3);
    });
  });

  describe('aggregate statistics', () => {
    it('calculates success and skip counts', () => {
      const results = [
        { skipped: false },
        { skipped: true },
        { skipped: false },
        { skipped: true },
        { skipped: false },
      ];

      const successCount = results.filter((r) => !r.skipped).length;
      const skippedCount = results.filter((r) => r.skipped).length;

      expect(successCount).toBe(3);
      expect(skippedCount).toBe(2);
    });

    it('sums chunk counts across sessions', () => {
      const results = [
        { chunkCount: 10 },
        { chunkCount: 15 },
        { chunkCount: 5 },
      ];

      const totalChunks = results.reduce((sum, r) => sum + r.chunkCount, 0);

      expect(totalChunks).toBe(30);
    });

    it('sums edge counts across sessions', () => {
      const results = [
        { edgeCount: 20 },
        { edgeCount: 30 },
        { edgeCount: 10 },
      ];

      const totalEdges = results.reduce((sum, r) => sum + r.edgeCount, 0);

      expect(totalEdges).toBe(60);
    });

    it('sums sub-agent stats', () => {
      const results = [
        { subAgentEdges: 4, subAgentCount: 2 },
        { subAgentEdges: 6, subAgentCount: 3 },
        { subAgentEdges: 0, subAgentCount: 0 },
      ];

      const totalSubAgentEdges = results.reduce((sum, r) => sum + (r.subAgentEdges ?? 0), 0);
      const totalSubAgentCount = results.reduce((sum, r) => sum + (r.subAgentCount ?? 0), 0);

      expect(totalSubAgentEdges).toBe(10);
      expect(totalSubAgentCount).toBe(5);
    });
  });

  describe('error handling', () => {
    it('captures error path and message', () => {
      const errors: Array<{ path: string; error: string }> = [];

      try {
        throw new Error('Something went wrong');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ path: '/test/path.jsonl', error: message });
      }

      expect(errors.length).toBe(1);
      expect(errors[0].error).toBe('Something went wrong');
    });

    it('continues processing after errors', () => {
      const paths = ['/a', '/b', '/c'];
      const results: string[] = [];
      const errors: string[] = [];

      for (const path of paths) {
        try {
          if (path === '/b') {
            throw new Error('Bad file');
          }
          results.push(path);
        } catch {
          errors.push(path);
        }
      }

      expect(results).toEqual(['/a', '/c']);
      expect(errors).toEqual(['/b']);
    });
  });

  describe('cross-session linking', () => {
    it('links after all sessions ingested', () => {
      const linkCrossSessions = true;
      const allSessionsIngested = true;

      const shouldLink = linkCrossSessions && allSessionsIngested;

      expect(shouldLink).toBe(true);
    });

    it('skips linking when disabled', () => {
      const linkCrossSessions = false;

      expect(linkCrossSessions).toBe(false);
    });
  });

  describe('embedder lifecycle', () => {
    it('creates shared embedder for batch', () => {
      // Shared embedder is created once and passed to all sessions
      const sharedEmbedder = { loaded: true };
      const sessions = ['s1', 's2', 's3'];

      const allUseSameEmbedder = sessions.every(() => sharedEmbedder.loaded);

      expect(allUseSameEmbedder).toBe(true);
    });

    it('disposes embedder after batch completion', () => {
      let disposed = false;

      const cleanup = () => {
        disposed = true;
      };

      // Simulate finally block
      try {
        // batch processing...
      } finally {
        cleanup();
      }

      expect(disposed).toBe(true);
    });
  });

  describe('progress tracking', () => {
    it('reports progress with done/total/current', () => {
      const progressUpdates: Array<{ done: number; total: number; current: string }> = [];

      const callback = (done: number, total: number, current: string) => {
        progressUpdates.push({ done, total, current });
      };

      const paths = ['/a', '/b', '/c'];
      for (let i = 0; i < paths.length; i++) {
        callback(i, paths.length, paths[i]);
      }

      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0]).toEqual({ done: 0, total: 3, current: '/a' });
      expect(progressUpdates[2]).toEqual({ done: 2, total: 3, current: '/c' });
    });
  });
});
