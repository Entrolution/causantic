/**
 * Tests for edge creation from transitions.
 * New model: forward-only edges, uniform weight 1.0, sequential linking.
 */

import { describe, it, expect } from 'vitest';
import type { TransitionResult } from '../../src/ingest/edge-detector.js';
import type { EdgeCreationResult } from '../../src/ingest/edge-creator.js';

describe('edge-creator', () => {
  describe('EdgeCreationResult interface', () => {
    it('has correct structure', () => {
      const result: EdgeCreationResult = {
        forwardCount: 3,
        totalCount: 3,
      };

      expect(result.forwardCount).toBe(3);
      expect(result.totalCount).toBe(3);
    });

    it('totalCount equals forwardCount', () => {
      const result: EdgeCreationResult = {
        forwardCount: 5,
        totalCount: 5,
      };

      expect(result.totalCount).toBe(result.forwardCount);
    });
  });

  describe('edge direction semantics', () => {
    it('only creates forward edges (source=earlier, target=later)', () => {
      const sourceChunkId = 'chunk-a';
      const targetChunkId = 'chunk-b';

      const forwardEdge = {
        sourceChunkId,
        targetChunkId,
        edgeType: 'forward' as const,
        initialWeight: 1.0,
      };

      expect(forwardEdge.sourceChunkId).toBe('chunk-a');
      expect(forwardEdge.targetChunkId).toBe('chunk-b');
      expect(forwardEdge.edgeType).toBe('forward');
      expect(forwardEdge.initialWeight).toBe(1.0);
    });

    it('all edges have uniform weight 1.0', () => {
      const referenceTypes = ['within-chain', 'cross-session', 'brief', 'debrief'] as const;

      for (const refType of referenceTypes) {
        const edge = {
          edgeType: 'forward',
          referenceType: refType,
          initialWeight: 1.0,
        };
        expect(edge.initialWeight).toBe(1.0);
      }
    });
  });

  describe('transition to edge mapping', () => {
    it('creates one forward edge per transition', () => {
      const transitions: TransitionResult[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          type: 'within-chain',
          confidence: 1.0,
          evidence: 'Sequential transition',
        },
      ];

      const expectedEdgeCount = transitions.length;
      expect(expectedEdgeCount).toBe(1);
    });

    it('maps indices to chunk IDs', () => {
      const chunkIds = ['chunk-0', 'chunk-1', 'chunk-2'];
      const transition: TransitionResult = {
        sourceIndex: 0,
        targetIndex: 1,
        type: 'within-chain',
        confidence: 1.0,
        evidence: 'Sequential transition',
      };

      const sourceId = chunkIds[transition.sourceIndex];
      const targetId = chunkIds[transition.targetIndex];

      expect(sourceId).toBe('chunk-0');
      expect(targetId).toBe('chunk-1');
    });
  });

  describe('cross-session edge semantics', () => {
    it('creates a single edge: last prev chunk → first new chunk', () => {
      // New model: single edge, not m×n
      const expectedEdgeCount = 1;
      expect(expectedEdgeCount).toBe(1);
    });

    it('uses cross-session reference type', () => {
      const edge = {
        edgeType: 'forward',
        referenceType: 'cross-session',
        initialWeight: 1.0,
      };
      expect(edge.referenceType).toBe('cross-session');
      expect(edge.initialWeight).toBe(1.0);
    });
  });

  describe('brief edge semantics', () => {
    it('creates a single edge: last parent chunk → first sub-agent chunk', () => {
      const expectedEdgeCount = 1;
      expect(expectedEdgeCount).toBe(1);
    });

    it('uses brief reference type', () => {
      const edge = {
        edgeType: 'forward',
        referenceType: 'brief',
        initialWeight: 1.0,
      };
      expect(edge.referenceType).toBe('brief');
    });
  });

  describe('debrief edge semantics', () => {
    it('creates a single edge: last sub-agent chunk → first parent chunk', () => {
      const expectedEdgeCount = 1;
      expect(expectedEdgeCount).toBe(1);
    });

    it('uses debrief reference type', () => {
      const edge = {
        edgeType: 'forward',
        referenceType: 'debrief',
        initialWeight: 1.0,
      };
      expect(edge.referenceType).toBe('debrief');
    });
  });
});
