/**
 * Tests for edge detection (topic continuity) between chunks.
 */

import { describe, it, expect } from 'vitest';
import { detectTransitions, getTimeGapMs } from '../../src/ingest/edge-detector.js';
import type { Chunk } from '../../src/parser/types.js';

function createTestChunk(overrides: Partial<{
  id: string;
  text: string;
  startTime: string;
  endTime: string;
  turnIndices: number[];
}>): Chunk {
  return {
    id: overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 10)}`,
    text: overrides.text ?? 'Test chunk content',
    metadata: {
      sessionId: 'test-session',
      sessionSlug: 'test-project',
      turnIndices: overrides.turnIndices ?? [0],
      startTime: overrides.startTime ?? '2024-01-01T00:00:00Z',
      endTime: overrides.endTime ?? '2024-01-01T00:01:00Z',
      codeBlockCount: 0,
      toolUseCount: 0,
      hasThinking: false,
      renderMode: 'full',
      approxTokens: 100,
    },
  };
}

describe('edge-detector', () => {
  describe('detectTransitions', () => {
    it('returns empty array for single chunk', () => {
      const chunks = [createTestChunk({ id: 'c1' })];
      const transitions = detectTransitions(chunks);
      expect(transitions).toEqual([]);
    });

    it('detects adjacent transitions between consecutive chunks', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'hello there',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: 'yes please',
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].sourceIndex).toBe(0);
      expect(transitions[0].targetIndex).toBe(1);
      expect(transitions[0].type).toBe('adjacent');
    });

    it('skips transitions with large time gaps', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          endTime: '2024-01-01T00:00:00Z',
        }),
        createTestChunk({
          id: 'c2',
          startTime: '2024-01-01T01:00:00Z', // 1 hour later
          endTime: '2024-01-01T01:01:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(0);
    });

    it('respects custom time gap threshold', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          endTime: '2024-01-01T00:00:00Z',
        }),
        createTestChunk({
          id: 'c2',
          startTime: '2024-01-01T00:45:00Z', // 45 min later
          endTime: '2024-01-01T00:46:00Z',
        }),
      ];

      // Default (30 min) should skip
      const transitions30 = detectTransitions(chunks);
      expect(transitions30.length).toBe(0);

      // Custom (60 min) should include
      const transitions60 = detectTransitions(chunks, { timeGapThresholdMs: 60 * 60 * 1000 });
      expect(transitions60.length).toBe(1);
    });

    it('skips transitions when user indicates topic shift', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: '[User]\nHelp me with TypeScript',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nActually, let\'s switch gears. Can you help with Python?',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(0);
    });

    it('detects file-path transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Reading /src/data/config.json now',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nPlease update /src/data/config.json',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('file-path');
      expect(transitions[0].confidence).toBeGreaterThan(0.7);
    });

    it('detects error-fragment transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'TypeError: x is not ok at row 5\n\noh no',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: 'i see x is not ok at row 5 in the log',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('error-fragment');
    });

    it('detects explicit backreference transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Here is the authentication function...',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nThe error from the previous fix is still happening',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('explicit-backref');
    });

    it('detects code-entity transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'The getUserById function returns a Promise...',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nNow getUserById throws when the user is not found',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('code-entity');
    });

    it('handles multiple chunks in sequence', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Chunk 1',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nChunk 2',
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
        createTestChunk({
          id: 'c3',
          text: '[User]\nChunk 3',
          startTime: '2024-01-01T00:04:00Z',
          endTime: '2024-01-01T00:05:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(2);
      expect(transitions[0].sourceIndex).toBe(0);
      expect(transitions[0].targetIndex).toBe(1);
      expect(transitions[1].sourceIndex).toBe(1);
      expect(transitions[1].targetIndex).toBe(2);
    });
  });

  describe('getTimeGapMs', () => {
    it('calculates time gap between chunks', () => {
      const chunk1 = createTestChunk({
        endTime: '2024-01-01T00:00:00Z',
      });
      const chunk2 = createTestChunk({
        startTime: '2024-01-01T00:05:00Z',
      });

      const gap = getTimeGapMs(chunk1, chunk2);
      expect(gap).toBe(5 * 60 * 1000); // 5 minutes in ms
    });

    it('handles negative gaps (overlapping chunks)', () => {
      const chunk1 = createTestChunk({
        endTime: '2024-01-01T00:05:00Z',
      });
      const chunk2 = createTestChunk({
        startTime: '2024-01-01T00:03:00Z',
      });

      const gap = getTimeGapMs(chunk1, chunk2);
      expect(gap).toBe(-2 * 60 * 1000); // -2 minutes
    });
  });

  describe('confidence scoring', () => {
    it('assigns higher confidence to file-path matches', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Working on /src/app.ts',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nContinuing with /src/app.ts',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('assigns lower confidence to simple adjacent transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Hello',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nWorld',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions[0].type).toBe('adjacent');
      expect(transitions[0].confidence).toBeLessThan(0.7);
    });
  });

  describe('evidence', () => {
    it('provides evidence for file-path transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Looking at /src/index.ts',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nUpdated /src/index.ts',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions[0].evidence).toContain('Shared paths');
    });

    it('provides evidence for adjacent transitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Hello',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nContinue',
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions[0].evidence).toContain('Adjacent');
    });
  });
});
