/**
 * Tests for team edge detection.
 *
 * Verifies detection of team-spawn, team-report, and peer-message edges
 * between team members, including chunk matching and timestamp fallback.
 */

import { describe, it, expect } from 'vitest';
import type { Turn, ToolUseBlock, RawMessage } from '../../src/parser/types.js';
import type { ChunkInput } from '../../src/storage/types.js';
import type { TeamTopology } from '../../src/ingest/team-detector.js';
import { detectTeamEdges } from '../../src/ingest/team-edge-detector.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    index: overrides.index ?? 0,
    startTime: overrides.startTime ?? '2024-01-15T10:00:00Z',
    userText: overrides.userText ?? '',
    assistantBlocks: overrides.assistantBlocks ?? [],
    toolExchanges: overrides.toolExchanges ?? [],
    hasThinking: overrides.hasThinking ?? false,
    rawMessages: overrides.rawMessages ?? [],
  };
}

function makeToolUse(name: string, input: Record<string, unknown>, id?: string): ToolUseBlock {
  return {
    type: 'tool_use',
    id: id ?? `tool-${crypto.randomUUID().slice(0, 8)}`,
    name,
    input,
  };
}

function makeChunk(overrides: Partial<ChunkInput> = {}): ChunkInput {
  return {
    id: overrides.id ?? `chunk-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: overrides.sessionId ?? 'session-1',
    sessionSlug: overrides.sessionSlug ?? 'proj',
    turnIndices: overrides.turnIndices ?? [0],
    startTime: overrides.startTime ?? '2024-01-15T10:00:00Z',
    endTime: overrides.endTime ?? '2024-01-15T10:05:00Z',
    content: overrides.content ?? 'Test content',
    codeBlockCount: overrides.codeBlockCount ?? 0,
    toolUseCount: overrides.toolUseCount ?? 0,
    approxTokens: overrides.approxTokens ?? 100,
  };
}

function makeRawMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    type: overrides.type ?? 'user',
    uuid: overrides.uuid ?? crypto.randomUUID(),
    timestamp: overrides.timestamp ?? '2024-01-15T10:00:00Z',
    sessionId: overrides.sessionId ?? 'test-session',
    parentUuid: overrides.parentUuid ?? null,
    isSidechain: overrides.isSidechain ?? false,
    message: overrides.message,
  };
}

function makeTopology(overrides: Partial<TeamTopology> = {}): TeamTopology {
  return {
    isTeamSession: overrides.isTeamSession ?? true,
    teamName: overrides.teamName ?? 'test-team',
    teammates: overrides.teammates ?? new Map(),
    teamAgentIds: overrides.teamAgentIds ?? new Set(),
  };
}

// ── detectTeamEdges ──────────────────────────────────────────────────────────

describe('detectTeamEdges', () => {
  describe('team-spawn edges', () => {
    it('detects team-spawn edge from Task with team_name', () => {
      const taskId = 'task-spawn';
      const mainChunk = makeChunk({ id: 'lead-chunk', turnIndices: [0] });
      const agentChunk = makeChunk({ id: 'agent-chunk' });

      const mainTurns = [
        makeTurn({
          index: 0,
          startTime: '2024-01-15T10:00:00Z',
          assistantBlocks: [
            makeToolUse('Task', { team_name: 'my-team', name: 'researcher' }, taskId),
          ],
          toolExchanges: [
            {
              toolName: 'Task',
              toolUseId: taskId,
              input: {},
              result: 'Task completed',
              isError: false,
            },
          ],
        }),
      ];

      const agentData = new Map([['researcher', { turns: [], chunks: [agentChunk] }]]);

      const topology = makeTopology({
        teammates: new Map([['hex-1', 'researcher']]),
        teamAgentIds: new Set(['hex-1']),
      });

      const edges = detectTeamEdges(mainTurns, [mainChunk], agentData, topology);

      expect(edges).toHaveLength(1);
      expect(edges[0].edgeType).toBe('team-spawn');
      expect(edges[0].sourceAgentId).toBe('lead');
      expect(edges[0].targetAgentId).toBe('researcher');
      expect(edges[0].sourceChunkIds).toEqual(['lead-chunk']);
      expect(edges[0].targetChunkIds).toEqual(['agent-chunk']);
    });

    it('skips Task without team_name', () => {
      const taskId = 'task-solo';
      const mainChunk = makeChunk({ id: 'lead-chunk', turnIndices: [0] });

      const mainTurns = [
        makeTurn({
          index: 0,
          assistantBlocks: [makeToolUse('Task', { description: 'Run tests' }, taskId)],
        }),
      ];

      const edges = detectTeamEdges(mainTurns, [mainChunk], new Map(), makeTopology());

      expect(edges).toHaveLength(0);
    });

    it('skips spawn when teammate has no chunks', () => {
      const taskId = 'task-empty';
      const mainChunk = makeChunk({ id: 'lead-chunk', turnIndices: [0] });

      const mainTurns = [
        makeTurn({
          index: 0,
          assistantBlocks: [makeToolUse('Task', { team_name: 'team', name: 'ghost' }, taskId)],
          toolExchanges: [
            {
              toolName: 'Task',
              toolUseId: taskId,
              input: {},
              result: 'Done',
              isError: false,
            },
          ],
        }),
      ];

      const agentData = new Map([['ghost', { turns: [], chunks: [] }]]);

      const edges = detectTeamEdges(mainTurns, [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });

    it('skips spawn when source chunk not found', () => {
      const taskId = 'task-no-chunk';
      // Main chunk does NOT contain turn index 0
      const mainChunk = makeChunk({ id: 'other-chunk', turnIndices: [5] });
      const agentChunk = makeChunk({ id: 'agent-chunk' });

      const mainTurns = [
        makeTurn({
          index: 0,
          assistantBlocks: [makeToolUse('Task', { team_name: 'team', name: 'worker' }, taskId)],
          toolExchanges: [
            {
              toolName: 'Task',
              toolUseId: taskId,
              input: {},
              result: 'Done',
              isError: false,
            },
          ],
        }),
      ];

      const agentData = new Map([['worker', { turns: [], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges(mainTurns, [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });
  });

  describe('team-report edges', () => {
    it('detects team-report edge from agent SendMessage to lead', () => {
      const sendId = 'send-report';
      const mainChunk = makeChunk({
        id: 'lead-receive-chunk',
        turnIndices: [1],
        startTime: '2024-01-15T10:05:00Z',
        endTime: '2024-01-15T10:10:00Z',
      });
      const agentChunk = makeChunk({
        id: 'agent-send-chunk',
        turnIndices: [0],
      });

      const agentTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:03:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'team-lead', summary: 'Task complete' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok": true}',
            isError: false,
          },
        ],
      });

      // Main turn that receives the teammate message
      const mainTurn = makeTurn({
        index: 1,
        startTime: '2024-01-15T10:05:00Z',
        rawMessages: [
          makeRawMessage({
            type: 'user',
            message: {
              role: 'user',
              content:
                '<teammate-message teammate_id="researcher" summary="Task complete">Results here</teammate-message>',
            },
          }),
        ],
      });

      const agentData = new Map([['researcher', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([mainTurn], [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(1);
      expect(edges[0].edgeType).toBe('team-report');
      expect(edges[0].sourceAgentId).toBe('researcher');
      expect(edges[0].targetAgentId).toBe('lead');
      expect(edges[0].sourceChunkIds).toEqual(['agent-send-chunk']);
      expect(edges[0].targetChunkIds).toEqual(['lead-receive-chunk']);
    });

    it('also recognizes "lead" as lead recipient', () => {
      const sendId = 'send-to-lead';
      const agentChunk = makeChunk({ id: 'agent-chunk', turnIndices: [0] });
      const mainChunk = makeChunk({
        id: 'main-chunk',
        turnIndices: [0],
        // Within 30s of send time for timestamp proximity fallback
        startTime: '2024-01-15T10:04:10Z',
        endTime: '2024-01-15T10:04:30Z',
      });

      const agentTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:04:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'lead', summary: 'Done' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      // Fallback to timestamp proximity — no XML match
      const mainTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:04:10Z',
        rawMessages: [],
      });

      const agentData = new Map([['worker', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([mainTurn], [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(1);
      expect(edges[0].edgeType).toBe('team-report');
    });
  });

  describe('peer-message edges', () => {
    it('detects peer-message edge between teammates', () => {
      const sendId = 'send-peer';
      const senderChunk = makeChunk({ id: 'sender-chunk', turnIndices: [0] });
      const receiverChunk = makeChunk({
        id: 'receiver-chunk',
        turnIndices: [1],
        startTime: '2024-01-15T10:02:00Z',
        endTime: '2024-01-15T10:05:00Z',
      });

      const senderTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:01:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'backend', summary: 'API ready' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      const receiverTurn = makeTurn({
        index: 1,
        startTime: '2024-01-15T10:02:00Z',
        rawMessages: [
          makeRawMessage({
            type: 'user',
            message: {
              role: 'user',
              content:
                '<teammate-message teammate_id="frontend" summary="API ready">Details</teammate-message>',
            },
          }),
        ],
      });

      const agentData = new Map([
        ['frontend', { turns: [senderTurn], chunks: [senderChunk] }],
        ['backend', { turns: [receiverTurn], chunks: [receiverChunk] }],
      ]);

      const edges = detectTeamEdges([], [], agentData, makeTopology());

      expect(edges).toHaveLength(1);
      expect(edges[0].edgeType).toBe('peer-message');
      expect(edges[0].sourceAgentId).toBe('frontend');
      expect(edges[0].targetAgentId).toBe('backend');
      expect(edges[0].sourceChunkIds).toEqual(['sender-chunk']);
      expect(edges[0].targetChunkIds).toEqual(['receiver-chunk']);
    });

    it('skips peer-message when target agent not found', () => {
      const sendId = 'send-missing';
      const senderChunk = makeChunk({ id: 'sender-chunk', turnIndices: [0] });

      const senderTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:01:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'nonexistent', summary: 'Hello' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      const agentData = new Map([['sender', { turns: [senderTurn], chunks: [senderChunk] }]]);

      const edges = detectTeamEdges([], [], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });
  });

  describe('timestamp proximity fallback', () => {
    it('falls back to timestamp proximity when no XML match', () => {
      const sendId = 'send-fallback';
      const agentChunk = makeChunk({
        id: 'agent-chunk',
        turnIndices: [0],
      });
      const mainChunk = makeChunk({
        id: 'main-chunk',
        turnIndices: [0],
        // Within 30s of send time
        startTime: '2024-01-15T10:00:10Z',
        endTime: '2024-01-15T10:00:20Z',
      });

      const agentTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:00:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'team-lead', summary: 'Update' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      // No <teammate-message> XML in main turns — will use timestamp fallback
      const mainTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:00:10Z',
        rawMessages: [
          makeRawMessage({
            type: 'user',
            message: { role: 'user', content: 'Regular user message' },
          }),
        ],
      });

      const agentData = new Map([['worker', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([mainTurn], [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(1);
      expect(edges[0].edgeType).toBe('team-report');
      expect(edges[0].targetChunkIds).toEqual(['main-chunk']);
    });

    it('does not match when timestamp is outside 30s window', () => {
      const sendId = 'send-far';
      const agentChunk = makeChunk({ id: 'agent-chunk', turnIndices: [0] });
      const mainChunk = makeChunk({
        id: 'main-chunk',
        turnIndices: [0],
        // More than 30s away from send time
        startTime: '2024-01-15T10:01:00Z',
        endTime: '2024-01-15T10:02:00Z',
      });

      const agentTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:00:00Z',
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'team-lead', summary: 'Update' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      const mainTurn = makeTurn({
        index: 0,
        startTime: '2024-01-15T10:01:00Z',
        rawMessages: [],
      });

      const agentData = new Map([['worker', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([mainTurn], [mainChunk], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no turns or agents', () => {
      const edges = detectTeamEdges([], [], new Map(), makeTopology());

      expect(edges).toHaveLength(0);
    });

    it('handles SendMessage without recipient', () => {
      const sendId = 'send-no-recipient';
      const agentChunk = makeChunk({ id: 'agent-chunk', turnIndices: [0] });

      const agentTurn = makeTurn({
        index: 0,
        assistantBlocks: [makeToolUse('SendMessage', { content: 'Hello' }, sendId)],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      const agentData = new Map([['worker', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([], [], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });

    it('handles multiple edge types in one session', () => {
      // Setup: lead spawns agent, agent reports back, agent messages peer
      const spawnTaskId = 'task-spawn-multi';
      const reportSendId = 'send-report-multi';
      const peerSendId = 'send-peer-multi';

      const leadChunk = makeChunk({
        id: 'lead-chunk',
        turnIndices: [0, 1],
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:10:00Z',
      });
      const workerChunk = makeChunk({
        id: 'worker-chunk',
        turnIndices: [0, 1],
        startTime: '2024-01-15T10:01:00Z',
        endTime: '2024-01-15T10:05:00Z',
      });
      const helperChunk = makeChunk({
        id: 'helper-chunk',
        turnIndices: [0],
        startTime: '2024-01-15T10:02:00Z',
        endTime: '2024-01-15T10:04:00Z',
      });

      // Lead spawns worker
      const mainTurns = [
        makeTurn({
          index: 0,
          startTime: '2024-01-15T10:00:00Z',
          assistantBlocks: [
            makeToolUse('Task', { team_name: 'team', name: 'worker' }, spawnTaskId),
          ],
          toolExchanges: [
            {
              toolName: 'Task',
              toolUseId: spawnTaskId,
              input: {},
              result: 'Spawned',
              isError: false,
            },
          ],
        }),
        // Lead receives report
        makeTurn({
          index: 1,
          startTime: '2024-01-15T10:06:00Z',
          rawMessages: [
            makeRawMessage({
              type: 'user',
              message: {
                role: 'user',
                content:
                  '<teammate-message teammate_id="worker" summary="Done">Result</teammate-message>',
              },
            }),
          ],
        }),
      ];

      // Worker sends report to lead and peer message to helper
      const workerTurns = [
        makeTurn({
          index: 0,
          startTime: '2024-01-15T10:03:00Z',
          assistantBlocks: [
            makeToolUse('SendMessage', { recipient: 'helper', summary: 'Need help' }, peerSendId),
          ],
          toolExchanges: [
            {
              toolName: 'SendMessage',
              toolUseId: peerSendId,
              input: {},
              result: '{"ok":true}',
              isError: false,
            },
          ],
        }),
        makeTurn({
          index: 1,
          startTime: '2024-01-15T10:05:00Z',
          assistantBlocks: [
            makeToolUse('SendMessage', { recipient: 'team-lead', summary: 'Done' }, reportSendId),
          ],
          toolExchanges: [
            {
              toolName: 'SendMessage',
              toolUseId: reportSendId,
              input: {},
              result: '{"ok":true}',
              isError: false,
            },
          ],
        }),
      ];

      // Helper receives peer message
      const helperTurns = [
        makeTurn({
          index: 0,
          startTime: '2024-01-15T10:03:30Z',
          rawMessages: [
            makeRawMessage({
              type: 'user',
              message: {
                role: 'user',
                content:
                  '<teammate-message teammate_id="worker" summary="Need help">Details</teammate-message>',
              },
            }),
          ],
        }),
      ];

      const agentData = new Map([
        ['worker', { turns: workerTurns, chunks: [workerChunk] }],
        ['helper', { turns: helperTurns, chunks: [helperChunk] }],
      ]);

      const topology = makeTopology();

      const edges = detectTeamEdges(mainTurns, [leadChunk], agentData, topology);

      // Expect 3 edges: spawn, peer-message, team-report
      expect(edges).toHaveLength(3);

      const edgeTypes = edges.map((e) => e.edgeType).sort();
      expect(edgeTypes).toEqual(['peer-message', 'team-report', 'team-spawn']);
    });

    it('skips SendMessage when source chunk not found', () => {
      const sendId = 'send-no-source';

      const agentTurn = makeTurn({
        index: 5, // No chunk contains this index
        assistantBlocks: [
          makeToolUse('SendMessage', { recipient: 'team-lead', summary: 'Done' }, sendId),
        ],
        toolExchanges: [
          {
            toolName: 'SendMessage',
            toolUseId: sendId,
            input: {},
            result: '{"ok":true}',
            isError: false,
          },
        ],
      });

      const agentChunk = makeChunk({ id: 'chunk-0', turnIndices: [0] });
      const agentData = new Map([['worker', { turns: [agentTurn], chunks: [agentChunk] }]]);

      const edges = detectTeamEdges([], [], agentData, makeTopology());

      expect(edges).toHaveLength(0);
    });
  });
});
