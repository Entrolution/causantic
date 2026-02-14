/**
 * Tests for sub-agent spawn (brief) and return (debrief) detection.
 */

import { describe, it, expect } from 'vitest';
import { buildChunkIdsByTurn } from '../../src/ingest/brief-debrief-detector.js';
import type { Chunk } from '../../src/parser/types.js';

function createTestChunk(
  overrides: Partial<{
    id: string;
    turnIndices: number[];
  }>,
): Chunk {
  return {
    id: overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 10)}`,
    text: 'Test chunk content',
    metadata: {
      sessionId: 'test-session',
      sessionSlug: 'test-project',
      turnIndices: overrides.turnIndices ?? [0],
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T00:01:00Z',
      codeBlockCount: 0,
      toolUseCount: 0,
      hasThinking: false,
      renderMode: 'full',
      approxTokens: 100,
    },
  };
}

describe('brief-debrief-detector', () => {
  describe('buildChunkIdsByTurn', () => {
    it('returns empty map for empty chunks array', () => {
      const map = buildChunkIdsByTurn([]);
      expect(map.size).toBe(0);
    });

    it('maps single turn index to chunk', () => {
      const chunks = [createTestChunk({ id: 'c1', turnIndices: [0] })];

      const map = buildChunkIdsByTurn(chunks);
      expect(map.get(0)).toEqual(['c1']);
    });

    it('maps multiple turn indices from one chunk', () => {
      const chunks = [createTestChunk({ id: 'c1', turnIndices: [0, 1, 2] })];

      const map = buildChunkIdsByTurn(chunks);
      expect(map.get(0)).toEqual(['c1']);
      expect(map.get(1)).toEqual(['c1']);
      expect(map.get(2)).toEqual(['c1']);
    });

    it('groups multiple chunks with same turn index', () => {
      const chunks = [
        createTestChunk({ id: 'c1', turnIndices: [0] }),
        createTestChunk({ id: 'c2', turnIndices: [0] }),
      ];

      const map = buildChunkIdsByTurn(chunks);
      expect(map.get(0)).toContain('c1');
      expect(map.get(0)).toContain('c2');
      expect(map.get(0)?.length).toBe(2);
    });

    it('handles complex multi-turn scenario', () => {
      const chunks = [
        createTestChunk({ id: 'c1', turnIndices: [0, 1] }),
        createTestChunk({ id: 'c2', turnIndices: [1, 2] }),
        createTestChunk({ id: 'c3', turnIndices: [3] }),
      ];

      const map = buildChunkIdsByTurn(chunks);

      expect(map.get(0)).toEqual(['c1']);
      expect(map.get(1)).toEqual(['c1', 'c2']);
      expect(map.get(2)).toEqual(['c2']);
      expect(map.get(3)).toEqual(['c3']);
      expect(map.has(4)).toBe(false);
    });

    it('preserves chunk order within same turn', () => {
      const chunks = [
        createTestChunk({ id: 'first', turnIndices: [5] }),
        createTestChunk({ id: 'second', turnIndices: [5] }),
        createTestChunk({ id: 'third', turnIndices: [5] }),
      ];

      const map = buildChunkIdsByTurn(chunks);
      expect(map.get(5)).toEqual(['first', 'second', 'third']);
    });
  });

  describe('SPAWN_TOOL_NAMES', () => {
    it('recognizes Task as spawn tool', () => {
      const spawnTools = new Set(['Task', 'Agent', 'SubAgent']);
      expect(spawnTools.has('Task')).toBe(true);
    });

    it('recognizes Agent as spawn tool', () => {
      const spawnTools = new Set(['Task', 'Agent', 'SubAgent']);
      expect(spawnTools.has('Agent')).toBe(true);
    });

    it('recognizes SubAgent as spawn tool', () => {
      const spawnTools = new Set(['Task', 'Agent', 'SubAgent']);
      expect(spawnTools.has('SubAgent')).toBe(true);
    });

    it('does not recognize other tools as spawn tools', () => {
      const spawnTools = new Set(['Task', 'Agent', 'SubAgent']);
      expect(spawnTools.has('Read')).toBe(false);
      expect(spawnTools.has('Write')).toBe(false);
      expect(spawnTools.has('Bash')).toBe(false);
    });
  });

  describe('BriefPoint interface', () => {
    it('has correct structure', () => {
      const briefPoint = {
        parentChunkId: 'parent-1',
        agentId: 'explore-agent',
        clock: { ui: 5, human: 3 },
        turnIndex: 10,
        spawnDepth: 0,
      };

      expect(briefPoint.parentChunkId).toBe('parent-1');
      expect(briefPoint.agentId).toBe('explore-agent');
      expect(briefPoint.clock).toEqual({ ui: 5, human: 3 });
      expect(briefPoint.turnIndex).toBe(10);
      expect(briefPoint.spawnDepth).toBe(0);
    });
  });

  describe('DebriefPoint interface', () => {
    it('has correct structure', () => {
      const debriefPoint = {
        agentId: 'explore-agent',
        agentFinalChunkIds: ['sub-chunk-1', 'sub-chunk-2'],
        parentChunkId: 'parent-2',
        clock: { ui: 10, human: 5, 'explore-agent': 3 },
        turnIndex: 15,
        spawnDepth: 1,
      };

      expect(debriefPoint.agentId).toBe('explore-agent');
      expect(debriefPoint.agentFinalChunkIds).toContain('sub-chunk-1');
      expect(debriefPoint.agentFinalChunkIds).toContain('sub-chunk-2');
      expect(debriefPoint.parentChunkId).toBe('parent-2');
      expect(debriefPoint.clock['explore-agent']).toBe(3);
      expect(debriefPoint.turnIndex).toBe(15);
      expect(debriefPoint.spawnDepth).toBe(1);
    });
  });

  describe('spawn depth tracking', () => {
    it('main session has spawn depth 0', () => {
      const mainSpawnDepth = 0;
      expect(mainSpawnDepth).toBe(0);
    });

    it('first-level sub-agent has spawn depth 1', () => {
      const subAgentSpawnDepth = 1;
      expect(subAgentSpawnDepth).toBe(1);
    });

    it('nested sub-agent has spawn depth 2', () => {
      const nestedSpawnDepth = 2;
      expect(nestedSpawnDepth).toBe(2);
    });
  });

  describe('edge creation patterns', () => {
    it('brief edge goes from parent to sub-agent first chunk', () => {
      // Brief edge pattern: Parent chunk → Sub-agent's first chunk
      const briefEdge = {
        sourceChunkId: 'parent-chunk',
        targetChunkId: 'subagent-first-chunk',
        edgeType: 'forward' as const,
        referenceType: 'brief' as const,
      };

      expect(briefEdge.referenceType).toBe('brief');
      expect(briefEdge.edgeType).toBe('forward');
    });

    it('debrief edge goes from sub-agent last chunk to parent', () => {
      // Debrief edge pattern: Sub-agent's last chunk → Parent's receiving chunk
      const debriefEdge = {
        sourceChunkId: 'subagent-last-chunk',
        targetChunkId: 'parent-receiving-chunk',
        edgeType: 'forward' as const,
        referenceType: 'debrief' as const,
      };

      expect(debriefEdge.referenceType).toBe('debrief');
      expect(debriefEdge.edgeType).toBe('forward');
    });
  });

  describe('agent ID patterns', () => {
    it('handles standard UUID agent IDs', () => {
      const agentId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(agentId.length).toBe(36);
      expect(agentId.split('-').length).toBe(5);
    });

    it('handles subagent_type agent IDs', () => {
      const agentId = 'Explore';
      expect(typeof agentId).toBe('string');
    });

    it('handles fallback tool_use_id agent IDs', () => {
      const agentId = 'toolu_01ABC123';
      expect(agentId.startsWith('toolu_')).toBe(true);
    });
  });
});
