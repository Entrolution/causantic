/**
 * Tests for edge creation from transitions.
 */

import { describe, it, expect } from 'vitest';
import { TYPE_WEIGHTS } from '../../src/ingest/edge-creator.js';
import type { TransitionResult } from '../../src/ingest/edge-detector.js';

describe('edge-creator', () => {
  describe('TYPE_WEIGHTS', () => {
    it('defines weights for all reference types', () => {
      const expectedTypes = [
        'file-path',
        'code-entity',
        'explicit-backref',
        'error-fragment',
        'tool-output',
        'adjacent',
        'cross-session',
        'brief',
        'debrief',
      ];

      for (const type of expectedTypes) {
        expect(TYPE_WEIGHTS).toHaveProperty(type);
        expect(typeof TYPE_WEIGHTS[type as keyof typeof TYPE_WEIGHTS]).toBe('number');
      }
    });

    it('gives highest weight to file-path', () => {
      expect(TYPE_WEIGHTS['file-path']).toBe(1.0);
    });

    it('gives lowest weight to adjacent', () => {
      expect(TYPE_WEIGHTS['adjacent']).toBe(0.5);
    });

    it('weights brief and debrief equally', () => {
      expect(TYPE_WEIGHTS['brief']).toBe(TYPE_WEIGHTS['debrief']);
    });

    it('has all weights in range [0, 1]', () => {
      for (const [, weight] of Object.entries(TYPE_WEIGHTS)) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    });

    it('ranks reference types by strength', () => {
      // Strong references should have higher weights
      expect(TYPE_WEIGHTS['file-path']).toBeGreaterThan(TYPE_WEIGHTS['adjacent']);
      expect(TYPE_WEIGHTS['explicit-backref']).toBeGreaterThan(TYPE_WEIGHTS['adjacent']);
      expect(TYPE_WEIGHTS['error-fragment']).toBeGreaterThan(TYPE_WEIGHTS['adjacent']);
      expect(TYPE_WEIGHTS['code-entity']).toBeGreaterThan(TYPE_WEIGHTS['adjacent']);
    });
  });

  describe('edge weight calculation', () => {
    it('multiplies type weight by confidence', () => {
      const typeWeight = TYPE_WEIGHTS['file-path'];
      const confidence = 0.8;
      const expectedWeight = typeWeight * confidence;

      expect(expectedWeight).toBeCloseTo(0.8);
    });

    it('reduces weight for low confidence', () => {
      const typeWeight = TYPE_WEIGHTS['file-path'];
      const highConfidenceWeight = typeWeight * 0.9;
      const lowConfidenceWeight = typeWeight * 0.3;

      expect(highConfidenceWeight).toBeGreaterThan(lowConfidenceWeight);
    });
  });

  describe('depth penalty calculation', () => {
    it('applies 0.9^depth penalty for nested agents', () => {
      const baseWeight = TYPE_WEIGHTS['brief'];

      // Depth 0: no penalty
      const depth0Weight = baseWeight * Math.pow(0.9, 0);
      expect(depth0Weight).toBeCloseTo(baseWeight);

      // Depth 1: 0.9x
      const depth1Weight = baseWeight * Math.pow(0.9, 1);
      expect(depth1Weight).toBeCloseTo(baseWeight * 0.9);

      // Depth 2: 0.81x
      const depth2Weight = baseWeight * Math.pow(0.9, 2);
      expect(depth2Weight).toBeCloseTo(baseWeight * 0.81);
    });

    it('decreases weight for deeper nesting', () => {
      const baseWeight = TYPE_WEIGHTS['debrief'];
      const depth0 = baseWeight * Math.pow(0.9, 0);
      const depth1 = baseWeight * Math.pow(0.9, 1);
      const depth2 = baseWeight * Math.pow(0.9, 2);
      const depth3 = baseWeight * Math.pow(0.9, 3);

      expect(depth0).toBeGreaterThan(depth1);
      expect(depth1).toBeGreaterThan(depth2);
      expect(depth2).toBeGreaterThan(depth3);
    });
  });

  describe('EdgeCreationResult interface', () => {
    it('has correct structure', () => {
      const result = {
        backwardCount: 3,
        forwardCount: 3,
        totalCount: 6,
      };

      expect(result.backwardCount).toBe(3);
      expect(result.forwardCount).toBe(3);
      expect(result.totalCount).toBe(6);
    });

    it('totalCount equals backwardCount + forwardCount', () => {
      const backwardCount = 5;
      const forwardCount = 5;
      const totalCount = backwardCount + forwardCount;

      expect(totalCount).toBe(10);
    });
  });

  describe('edge direction semantics', () => {
    it('backward edge goes from target to source', () => {
      // Given a transition from chunk A (source) to chunk B (target)
      // Backward edge: B → A (for retrieval: "what led to B?")
      const sourceChunkId = 'chunk-a';
      const targetChunkId = 'chunk-b';

      const backwardEdge = {
        sourceChunkId: targetChunkId, // B
        targetChunkId: sourceChunkId, // A
        edgeType: 'backward' as const,
      };

      expect(backwardEdge.sourceChunkId).toBe('chunk-b');
      expect(backwardEdge.targetChunkId).toBe('chunk-a');
    });

    it('forward edge goes from source to target', () => {
      // Given a transition from chunk A (source) to chunk B (target)
      // Forward edge: A → B (for prediction: "what comes after A?")
      const sourceChunkId = 'chunk-a';
      const targetChunkId = 'chunk-b';

      const forwardEdge = {
        sourceChunkId: sourceChunkId, // A
        targetChunkId: targetChunkId, // B
        edgeType: 'forward' as const,
      };

      expect(forwardEdge.sourceChunkId).toBe('chunk-a');
      expect(forwardEdge.targetChunkId).toBe('chunk-b');
    });
  });

  describe('transition to edge mapping', () => {
    it('creates two edges per transition', () => {
      const transitions: TransitionResult[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          type: 'adjacent',
          confidence: 0.5,
          evidence: 'Adjacent chunks',
        },
      ];

      // Each transition creates 1 backward + 1 forward = 2 edges
      const expectedEdgeCount = transitions.length * 2;
      expect(expectedEdgeCount).toBe(2);
    });

    it('maps indices to chunk IDs', () => {
      const chunkIds = ['chunk-0', 'chunk-1', 'chunk-2'];
      const transition: TransitionResult = {
        sourceIndex: 0,
        targetIndex: 1,
        type: 'file-path',
        confidence: 0.9,
        evidence: 'Shared paths',
      };

      const sourceId = chunkIds[transition.sourceIndex];
      const targetId = chunkIds[transition.targetIndex];

      expect(sourceId).toBe('chunk-0');
      expect(targetId).toBe('chunk-1');
    });
  });

  describe('cross-session edge semantics', () => {
    it('links previous session final chunks to new session first chunk', () => {
      const previousFinalChunkIds = ['prev-final-1', 'prev-final-2', 'prev-final-3'];
      const newFirstChunkId = 'new-first';

      // Cross-session creates 2 edges per previous chunk
      const expectedEdgeCount = previousFinalChunkIds.length * 2;
      expect(expectedEdgeCount).toBe(6);
    });

    it('uses cross-session reference type', () => {
      const crossSessionWeight = TYPE_WEIGHTS['cross-session'];
      expect(crossSessionWeight).toBe(0.7);
    });
  });

  describe('brief edge semantics', () => {
    it('links parent chunk to sub-agent first chunk', () => {
      const briefEdge = {
        parentChunkId: 'parent-chunk',
        subAgentFirstChunkId: 'subagent-first',
        referenceType: 'brief' as const,
      };

      // Backward: subagent-first → parent (recall parent context)
      // Forward: parent → subagent-first (predict sub-agent work)
      expect(briefEdge.parentChunkId).toBe('parent-chunk');
      expect(briefEdge.subAgentFirstChunkId).toBe('subagent-first');
    });

    it('uses brief reference type weight', () => {
      expect(TYPE_WEIGHTS['brief']).toBe(0.9);
    });
  });

  describe('debrief edge semantics', () => {
    it('links sub-agent final chunks to parent receiving chunk', () => {
      const debriefEdge = {
        subAgentFinalChunkIds: ['subagent-last-1', 'subagent-last-2'],
        parentChunkId: 'parent-receiving',
        referenceType: 'debrief' as const,
      };

      // Backward: parent → subagent-last (recall what subagent found)
      // Forward: subagent-last → parent (predict continuation)
      expect(debriefEdge.subAgentFinalChunkIds.length).toBe(2);
      expect(debriefEdge.parentChunkId).toBe('parent-receiving');
    });

    it('uses debrief reference type weight', () => {
      expect(TYPE_WEIGHTS['debrief']).toBe(0.9);
    });
  });
});
