/**
 * Tests for benchmark sampler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, setupTestDb, teardownTestDb, createSampleChunk, insertTestChunk, insertTestEdge } from '../../storage/test-utils.js';
import { generateSamples, checkThresholds } from '../../../src/eval/collection-benchmark/sampler.js';
import { getAllChunks } from '../../../src/storage/chunk-store.js';
import { getAllEdges } from '../../../src/storage/edge-store.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setupTestDb(db);
});

afterEach(() => {
  teardownTestDb(db);
});

describe('checkThresholds', () => {
  it('should report all thresholds as false for empty collection', () => {
    const chunks = getAllChunks();
    const edges = getAllEdges();
    const thresholds = checkThresholds(chunks, edges);

    expect(thresholds.canRunAdjacentRecall).toBe(false);
    expect(thresholds.canRunCrossSessionBridging).toBe(false);
    expect(thresholds.canRunPrecisionAtK).toBe(false);
  });

  it('should enable adjacent recall with enough sessions', () => {
    // Create 2 sessions with 3 chunks each
    for (let s = 0; s < 2; s++) {
      for (let c = 0; c < 3; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-s${s}-c${c}`,
          sessionId: `session-${s}`,
          sessionSlug: 'project-a',
          startTime: `2024-01-01T0${s}:0${c}:00Z`,
          endTime: `2024-01-01T0${s}:0${c}:30Z`,
        }));
      }
    }

    const chunks = getAllChunks();
    const edges = getAllEdges();
    const thresholds = checkThresholds(chunks, edges);

    expect(thresholds.canRunAdjacentRecall).toBe(true);
  });

  it('should disable adjacent recall with only 1 session', () => {
    for (let c = 0; c < 5; c++) {
      insertTestChunk(db, createSampleChunk({
        id: `chunk-c${c}`,
        sessionId: 'session-0',
        sessionSlug: 'project-a',
        startTime: `2024-01-01T00:0${c}:00Z`,
        endTime: `2024-01-01T00:0${c}:30Z`,
      }));
    }

    const chunks = getAllChunks();
    const edges = getAllEdges();
    const thresholds = checkThresholds(chunks, edges);

    expect(thresholds.canRunAdjacentRecall).toBe(false);
    expect(thresholds.reasons.has('adjacentRecall')).toBe(true);
  });

  it('should enable precision@K with 2+ projects with 10+ chunks', () => {
    for (const proj of ['project-a', 'project-b']) {
      for (let c = 0; c < 10; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-${proj}-c${c}`,
          sessionId: `session-${proj}`,
          sessionSlug: proj,
          startTime: `2024-01-01T00:0${c}:00Z`,
          endTime: `2024-01-01T00:0${c}:30Z`,
        }));
      }
    }

    const chunks = getAllChunks();
    const edges = getAllEdges();
    const thresholds = checkThresholds(chunks, edges);

    expect(thresholds.canRunPrecisionAtK).toBe(true);
  });
});

describe('generateSamples', () => {
  it('should produce deterministic results with same seed', () => {
    // Create enough data
    for (let s = 0; s < 3; s++) {
      for (let c = 0; c < 5; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-s${s}-c${c}`,
          sessionId: `session-${s}`,
          sessionSlug: 'project-a',
          startTime: `2024-01-01T0${s}:0${c}:00Z`,
          endTime: `2024-01-01T0${s}:0${c}:30Z`,
        }));
      }
    }

    const sample1 = generateSamples({ sampleSize: 10, seed: 42 });
    const sample2 = generateSamples({ sampleSize: 10, seed: 42 });

    expect(sample1.queryChunkIds).toEqual(sample2.queryChunkIds);
    expect(sample1.adjacentPairs).toEqual(sample2.adjacentPairs);
  });

  it('should produce different results with different seeds', () => {
    for (let s = 0; s < 3; s++) {
      for (let c = 0; c < 5; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-s${s}-c${c}`,
          sessionId: `session-${s}`,
          sessionSlug: 'project-a',
          startTime: `2024-01-01T0${s}:0${c}:00Z`,
          endTime: `2024-01-01T0${s}:0${c}:30Z`,
        }));
      }
    }

    const sample1 = generateSamples({ sampleSize: 10, seed: 42 });
    const sample2 = generateSamples({ sampleSize: 10, seed: 99 });

    expect(sample1.queryChunkIds).not.toEqual(sample2.queryChunkIds);
  });

  it('should handle empty collection gracefully', () => {
    const sample = generateSamples({ sampleSize: 10, seed: 42 });

    expect(sample.queryChunkIds).toHaveLength(0);
    expect(sample.adjacentPairs).toHaveLength(0);
    expect(sample.crossSessionPairs).toHaveLength(0);
    expect(sample.crossProjectPairs).toHaveLength(0);
  });

  it('should respect projectFilter', () => {
    for (const proj of ['project-a', 'project-b']) {
      for (let c = 0; c < 5; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-${proj}-c${c}`,
          sessionId: `session-${proj}`,
          sessionSlug: proj,
        }));
      }
    }

    const sample = generateSamples({ sampleSize: 10, seed: 42, projectFilter: 'project-a' });

    // All query chunks should be from project-a
    const chunks = getAllChunks();
    const projectAIds = new Set(chunks.filter(c => c.sessionSlug === 'project-a').map(c => c.id));
    for (const id of sample.queryChunkIds) {
      expect(projectAIds.has(id)).toBe(true);
    }
  });

  it('should generate cross-session pairs when edges exist', () => {
    // Create 3 sessions in same project
    for (let s = 0; s < 3; s++) {
      for (let c = 0; c < 4; c++) {
        insertTestChunk(db, createSampleChunk({
          id: `chunk-s${s}-c${c}`,
          sessionId: `session-${s}`,
          sessionSlug: 'project-a',
          startTime: `2024-01-0${s + 1}T0${c}:00:00Z`,
          endTime: `2024-01-0${s + 1}T0${c}:30:00Z`,
        }));
      }
    }

    // Add cross-session edges
    insertTestEdge(db, {
      id: 'edge-1',
      sourceChunkId: 'chunk-s0-c0',
      targetChunkId: 'chunk-s1-c0',
      edgeType: 'backward',
      referenceType: 'file-path',
    });

    const sample = generateSamples({ sampleSize: 10, seed: 42 });
    expect(sample.crossSessionPairs.length).toBeGreaterThan(0);
  });

  it('should limit samples to sampleSize', () => {
    for (let c = 0; c < 100; c++) {
      insertTestChunk(db, createSampleChunk({
        id: `chunk-c${c}`,
        sessionId: `session-0`,
        sessionSlug: 'project-a',
      }));
    }

    const sample = generateSamples({ sampleSize: 5, seed: 42 });
    expect(sample.queryChunkIds.length).toBeLessThanOrEqual(5);
  });
});
