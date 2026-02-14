/**
 * Tests for causal transition detection between chunks.
 */

import { describe, it, expect } from 'vitest';
import {
  detectCausalTransitions,
  detectTransitions,
  getTimeGapMs,
} from '../../src/ingest/edge-detector.js';
import type { Chunk } from '../../src/parser/types.js';

function createTestChunk(
  overrides: Partial<{
    id: string;
    text: string;
    startTime: string;
    endTime: string;
    turnIndices: number[];
  }>,
): Chunk {
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
  describe('detectCausalTransitions', () => {
    it('returns empty array for single chunk', () => {
      const chunks = [createTestChunk({ id: 'c1' })];
      const transitions = detectCausalTransitions(chunks);
      expect(transitions).toEqual([]);
    });

    it('detects within-chain transitions between consecutive turns', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'hello there',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: 'yes please',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].sourceIndex).toBe(0);
      expect(transitions[0].targetIndex).toBe(1);
      expect(transitions[0].type).toBe('within-chain');
      expect(transitions[0].confidence).toBe(1.0);
    });

    it('creates sequential edges at turn boundaries (last→first)', () => {
      // Turn 0 has 2 chunks, turn 1 has 2 chunks
      // Sequential: c1→c2 (intra-turn 0), c2→c3 (inter-turn), c3→c4 (intra-turn 1) = 3 edges
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c3',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
        createTestChunk({
          id: 'c4',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      // Intra-turn 0: c1→c2, inter-turn: c2→c3, intra-turn 1: c3→c4
      expect(transitions.length).toBe(3);
      // All should be within-chain with confidence 1.0
      for (const t of transitions) {
        expect(t.type).toBe('within-chain');
        expect(t.confidence).toBe(1.0);
      }
    });

    it('creates intra-turn sequential edges for multi-chunk turns', () => {
      // Two chunks in the same turn → 1 intra-turn edge (c1→c2)
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].sourceIndex).toBe(0);
      expect(transitions[0].targetIndex).toBe(1);
    });

    it('skips transitions with large time gaps', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:00:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [1],
          startTime: '2024-01-01T01:00:00Z', // 1 hour later
          endTime: '2024-01-01T01:01:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions.length).toBe(0);
    });

    it('respects custom time gap threshold', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:00:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [1],
          startTime: '2024-01-01T00:45:00Z', // 45 min later
          endTime: '2024-01-01T00:46:00Z',
        }),
      ];

      // Default (30 min) should skip
      const transitions30 = detectCausalTransitions(chunks);
      expect(transitions30.length).toBe(0);

      // Custom (60 min) should include
      const transitions60 = detectCausalTransitions(chunks, { timeGapThresholdMs: 60 * 60 * 1000 });
      expect(transitions60.length).toBe(1);
    });

    it('skips transitions when user indicates topic shift', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: '[User]\nHelp me with TypeScript',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: "[User]\nActually, let's switch gears. Can you help with Python?",
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions.length).toBe(0);
    });

    it('handles multiple turns in sequence', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          text: 'Chunk 1',
          turnIndices: [0],
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          text: '[User]\nChunk 2',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
        createTestChunk({
          id: 'c3',
          text: '[User]\nChunk 3',
          turnIndices: [2],
          startTime: '2024-01-01T00:04:00Z',
          endTime: '2024-01-01T00:05:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions.length).toBe(2);
      expect(transitions[0].sourceIndex).toBe(0);
      expect(transitions[0].targetIndex).toBe(1);
      expect(transitions[1].sourceIndex).toBe(1);
      expect(transitions[1].targetIndex).toBe(2);
    });

    it('deduplicates pairs for chunks spanning multiple turns', () => {
      // Chunk c2 spans turns 1 and 2, so it appears in both turn groups
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [1, 2],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
        createTestChunk({
          id: 'c3',
          turnIndices: [3],
          startTime: '2024-01-01T00:04:00Z',
          endTime: '2024-01-01T00:05:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      // Should have: c1→c2 (turn 0→1), c2→c3 (turn 2→3)
      // No duplicate c1→c2 or c2→c3
      const pairKeys = transitions.map((t) => `${t.sourceIndex}:${t.targetIndex}`);
      const uniquePairKeys = new Set(pairKeys);
      expect(pairKeys.length).toBe(uniquePairKeys.size);
    });
  });

  describe('detectTransitions (legacy alias)', () => {
    it('delegates to detectCausalTransitions', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
          endTime: '2024-01-01T00:03:00Z',
        }),
      ];

      const transitions = detectTransitions(chunks);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('within-chain');
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

  describe('evidence', () => {
    it('provides evidence with turn numbers', () => {
      const chunks = [
        createTestChunk({
          id: 'c1',
          turnIndices: [0],
          endTime: '2024-01-01T00:01:00Z',
        }),
        createTestChunk({
          id: 'c2',
          turnIndices: [1],
          startTime: '2024-01-01T00:02:00Z',
        }),
      ];

      const transitions = detectCausalTransitions(chunks);
      expect(transitions[0].evidence).toContain('turn 0');
      expect(transitions[0].evidence).toContain('turn 1');
    });
  });
});
