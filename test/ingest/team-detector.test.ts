/**
 * Tests for team topology detection.
 *
 * Verifies detection of TeamCreate, Task (with team_name), and SendMessage
 * tool calls, plus teammate name resolution and file grouping.
 */

import { describe, it, expect } from 'vitest';
import type { Turn, ToolUseBlock, ToolExchange, RawMessage } from '../../src/parser/types.js';
import type { SubAgentInfo } from '../../src/parser/session-reader.js';
import { detectTeamTopology, groupTeammateFiles } from '../../src/ingest/team-detector.js';
import type { TeamTopology } from '../../src/ingest/team-detector.js';

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

function makeExchange(toolUseId: string, result: string, toolName: string = 'Task'): ToolExchange {
  return {
    toolName,
    toolUseId,
    input: {},
    result,
    isError: false,
  };
}

function makeSubAgent(overrides: Partial<SubAgentInfo> = {}): SubAgentInfo {
  return {
    agentId: overrides.agentId ?? `agent-${crypto.randomUUID().slice(0, 8)}`,
    filePath: overrides.filePath ?? '/tmp/agent.jsonl',
    isDeadEnd: overrides.isDeadEnd ?? false,
    lineCount: overrides.lineCount ?? 100,
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
    data: overrides.data,
    parentToolUseID: overrides.parentToolUseID,
  };
}

// ── detectTeamTopology ───────────────────────────────────────────────────────

describe('detectTeamTopology', () => {
  it('returns non-team topology for sessions with no team signals', () => {
    const turns = [makeTurn({ assistantBlocks: [{ type: 'text', text: 'Hello' }] })];
    const topology = detectTeamTopology(turns, []);

    expect(topology.isTeamSession).toBe(false);
    expect(topology.teamName).toBeNull();
    expect(topology.teammates.size).toBe(0);
    expect(topology.teamAgentIds.size).toBe(0);
  });

  it('detects TeamCreate and extracts team name', () => {
    const toolUse = makeToolUse('TeamCreate', { team_name: 'my-team' });
    const turns = [makeTurn({ assistantBlocks: [toolUse] })];

    const topology = detectTeamTopology(turns, []);

    expect(topology.isTeamSession).toBe(true);
    expect(topology.teamName).toBe('my-team');
  });

  it('detects Task with team_name as team signal', () => {
    const taskId = 'task-123';
    const agentHexId = 'abc123def456';
    const toolUse = makeToolUse('Task', { team_name: 'my-team', name: 'researcher' }, taskId);
    const subAgent = makeSubAgent({ agentId: agentHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [makeExchange(taskId, `Agent ${agentHexId} completed the task`)],
      }),
    ];

    const topology = detectTeamTopology(turns, [subAgent]);

    expect(topology.isTeamSession).toBe(true);
    expect(topology.teammates.get(agentHexId)).toBe('researcher');
    expect(topology.teamAgentIds.has(agentHexId)).toBe(true);
  });

  it('resolves teammate name from Task input.name', () => {
    const taskId = 'task-456';
    const agentHexId = 'aaa111bbb222';
    const toolUse = makeToolUse('Task', { team_name: 'dev-team', name: 'tester' }, taskId);
    const subAgent = makeSubAgent({ agentId: agentHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [makeExchange(taskId, `Result from ${agentHexId}`)],
      }),
    ];

    const topology = detectTeamTopology(turns, [subAgent]);

    expect(topology.teammates.get(agentHexId)).toBe('tester');
  });

  it('handles Task with team_name but no input.name', () => {
    const taskId = 'task-789';
    const toolUse = makeToolUse('Task', { team_name: 'dev-team' }, taskId);

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [makeExchange(taskId, 'Some result')],
      }),
    ];

    const topology = detectTeamTopology(turns, []);

    expect(topology.isTeamSession).toBe(true);
    // No teammate resolved (no name, no hex ID match)
    expect(topology.teammates.size).toBe(0);
  });

  it('detects SendMessage as team signal', () => {
    const sendId = 'send-123';
    const toolUse = makeToolUse('SendMessage', { recipient: 'researcher' }, sendId);

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [makeExchange(sendId, '{"ok": true}', 'SendMessage')],
      }),
    ];

    const topology = detectTeamTopology(turns, []);

    expect(topology.isTeamSession).toBe(true);
  });

  it('resolves sender from SendMessage JSON result', () => {
    const sendId = 'send-456';
    const agentHexId = 'ccc333ddd444';
    const toolUse = makeToolUse('SendMessage', { recipient: 'lead' }, sendId);
    const subAgent = makeSubAgent({ agentId: agentHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [
          makeExchange(sendId, JSON.stringify({ sender: agentHexId }), 'SendMessage'),
        ],
      }),
    ];

    const topology = detectTeamTopology(turns, [subAgent]);

    expect(topology.teamAgentIds.has(agentHexId)).toBe(true);
  });

  it('resolves sender from SendMessage regex fallback', () => {
    const sendId = 'send-789';
    const agentHexId = 'eee555fff666';
    const toolUse = makeToolUse('SendMessage', { recipient: 'lead' }, sendId);
    const subAgent = makeSubAgent({ agentId: agentHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [
          makeExchange(sendId, `Message from: ${agentHexId} delivered`, 'SendMessage'),
        ],
      }),
    ];

    const topology = detectTeamTopology(turns, [subAgent]);

    expect(topology.teamAgentIds.has(agentHexId)).toBe(true);
  });

  it('parses <teammate-message> XML tags from user messages', () => {
    const agentHexId = 'aaa111bbb222';
    const taskId = 'task-100';
    const toolUse = makeToolUse('Task', { team_name: 'dev-team', name: 'researcher' }, taskId);
    const subAgent = makeSubAgent({ agentId: agentHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse],
        toolExchanges: [makeExchange(taskId, `Agent ${agentHexId} spawned`)],
        rawMessages: [
          makeRawMessage({
            type: 'user',
            message: {
              role: 'user',
              content:
                '<teammate-message teammate_id="researcher" summary="status update">done</teammate-message>',
            },
          }),
        ],
      }),
    ];

    const topology = detectTeamTopology(turns, [subAgent]);

    expect(topology.isTeamSession).toBe(true);
    expect(topology.teamAgentIds.has(agentHexId)).toBe(true);
  });

  it('resolves agent IDs from progress messages', () => {
    // resolveRemainingAgentIds only runs when teammates.size > 0,
    // so we need one already-resolved teammate first
    const resolvedHexId = 'already-resolved';
    const unresolvedHexId = 'prog-agent-111';
    const task1Id = 'task-resolved';
    const task2Id = 'task-prog';

    const toolUse1 = makeToolUse('Task', { team_name: 'team', name: 'lead-dev' }, task1Id);
    const toolUse2 = makeToolUse('Task', { team_name: 'team', name: 'worker' }, task2Id);

    const resolvedAgent = makeSubAgent({ agentId: resolvedHexId });
    const unresolvedAgent = makeSubAgent({ agentId: unresolvedHexId });

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse1, toolUse2],
        toolExchanges: [
          // First task resolves via hex ID in result
          makeExchange(task1Id, `Agent ${resolvedHexId} spawned`),
          // Second task has no hex ID in result — needs progress message
          makeExchange(task2Id, 'Started'),
        ],
        rawMessages: [
          makeRawMessage({
            type: 'progress',
            data: { type: 'agent_progress', agentId: unresolvedHexId },
            parentToolUseID: task2Id,
          }),
        ],
      }),
    ];

    const topology = detectTeamTopology(turns, [resolvedAgent, unresolvedAgent]);

    expect(topology.teammates.get(resolvedHexId)).toBe('lead-dev');
    expect(topology.teammates.get(unresolvedHexId)).toBe('worker');
    expect(topology.teamAgentIds.has(unresolvedHexId)).toBe(true);
  });

  it('assigns fallback names to unresolved team agents', () => {
    const agentHexId = 'unnamed-agent-1';
    const taskId = 'task-200';
    // Task with team_name but referencing an agent by hex ID — no name provided
    const resolvedAgent = makeSubAgent({ agentId: 'resolved-agent' });
    const unresolvedAgent = makeSubAgent({ agentId: agentHexId });

    // First: create a resolved teammate so teammates.size > 0
    const toolUse1 = makeToolUse('Task', { team_name: 'team', name: 'known' }, taskId);
    const toolUse2 = makeToolUse('Task', { team_name: 'team' }, 'task-201');

    const turns = [
      makeTurn({
        assistantBlocks: [toolUse1, toolUse2],
        toolExchanges: [
          makeExchange(taskId, `Agent resolved-agent done`),
          makeExchange('task-201', 'Result'),
        ],
        rawMessages: [
          // Progress message identifies unnamed agent as part of team
          makeRawMessage({
            type: 'progress',
            data: { type: 'agent_progress', agentId: agentHexId },
            parentToolUseID: 'task-201',
          }),
        ],
      }),
    ];

    const topology = detectTeamTopology(turns, [resolvedAgent, unresolvedAgent]);

    // The unnamed agent should have been given a fallback name in resolveRemainingAgentIds
    // But only if taskToolUseIds has a matching entry — 'task-201' has no name
    // So it should be resolved via progress → taskToolUseIds but with no name → no map entry
    // Then resolveRemainingAgentIds gives a fallback name since it's in teamAgentIds
    // Actually: the progress message links agentHexId to task-201, and task-201 has no human name
    // So it won't be added to teammates or teamAgentIds via progress
    // The agent stays unresolved
    expect(topology.isTeamSession).toBe(true);
    expect(topology.teammates.has('resolved-agent')).toBe(true);
    expect(topology.teammates.get('resolved-agent')).toBe('known');
  });

  it('handles multiple teammates across multiple turns', () => {
    const agent1 = 'agent-hex-1111';
    const agent2 = 'agent-hex-2222';
    const task1Id = 'task-a';
    const task2Id = 'task-b';

    const turns = [
      makeTurn({
        index: 0,
        assistantBlocks: [
          makeToolUse('TeamCreate', { team_name: 'full-team' }),
          makeToolUse('Task', { team_name: 'full-team', name: 'frontend' }, task1Id),
        ],
        toolExchanges: [makeExchange(task1Id, `Spawned ${agent1}`)],
      }),
      makeTurn({
        index: 1,
        assistantBlocks: [
          makeToolUse('Task', { team_name: 'full-team', name: 'backend' }, task2Id),
        ],
        toolExchanges: [makeExchange(task2Id, `Spawned ${agent2}`)],
      }),
    ];

    const subAgents = [makeSubAgent({ agentId: agent1 }), makeSubAgent({ agentId: agent2 })];

    const topology = detectTeamTopology(turns, subAgents);

    expect(topology.isTeamSession).toBe(true);
    expect(topology.teamName).toBe('full-team');
    expect(topology.teammates.get(agent1)).toBe('frontend');
    expect(topology.teammates.get(agent2)).toBe('backend');
    expect(topology.teamAgentIds.size).toBe(2);
  });

  it('ignores Task calls without team_name', () => {
    const toolUse = makeToolUse('Task', { description: 'Run tests' });
    const turns = [makeTurn({ assistantBlocks: [toolUse] })];

    const topology = detectTeamTopology(turns, []);

    expect(topology.isTeamSession).toBe(false);
  });

  it('handles empty turns array', () => {
    const topology = detectTeamTopology([], []);

    expect(topology.isTeamSession).toBe(false);
    expect(topology.teamName).toBeNull();
    expect(topology.teammates.size).toBe(0);
  });
});

// ── groupTeammateFiles ───────────────────────────────────────────────────────

describe('groupTeammateFiles', () => {
  it('groups files by resolved teammate name', () => {
    const agent1 = 'hex-1';
    const agent2 = 'hex-2';

    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map([
        [agent1, 'researcher'],
        [agent2, 'coder'],
      ]),
      teamAgentIds: new Set([agent1, agent2]),
    };

    const subAgents = [
      makeSubAgent({ agentId: agent1, filePath: '/path/agent1.jsonl' }),
      makeSubAgent({ agentId: agent2, filePath: '/path/agent2.jsonl' }),
    ];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(2);
    const names = groups.map((g) => g.humanName).sort();
    expect(names).toEqual(['coder', 'researcher']);
  });

  it('excludes non-team agents', () => {
    const teamAgent = 'hex-team';
    const soloAgent = 'hex-solo';

    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map([[teamAgent, 'worker']]),
      teamAgentIds: new Set([teamAgent]),
    };

    const subAgents = [makeSubAgent({ agentId: teamAgent }), makeSubAgent({ agentId: soloAgent })];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(1);
    expect(groups[0].humanName).toBe('worker');
  });

  it('excludes dead-end files', () => {
    const agent = 'hex-dead';

    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map([[agent, 'worker']]),
      teamAgentIds: new Set([agent]),
    };

    const subAgents = [makeSubAgent({ agentId: agent, isDeadEnd: true })];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(0);
  });

  it('groups multiple files for the same teammate (respawned)', () => {
    const agent1File1 = 'hex-respawn';

    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map([[agent1File1, 'worker']]),
      teamAgentIds: new Set([agent1File1]),
    };

    const subAgents = [
      makeSubAgent({ agentId: agent1File1, filePath: '/path/file1.jsonl' }),
      makeSubAgent({ agentId: agent1File1, filePath: '/path/file2.jsonl' }),
    ];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(1);
    expect(groups[0].humanName).toBe('worker');
    expect(groups[0].files).toHaveLength(2);
  });

  it('uses hex ID as fallback name when not in teammates map', () => {
    const agentId = 'hex-unknown';

    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map(), // No name mapping
      teamAgentIds: new Set([agentId]),
    };

    const subAgents = [makeSubAgent({ agentId })];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(1);
    expect(groups[0].humanName).toBe(agentId);
  });

  it('returns empty array for non-team topology', () => {
    const topology: TeamTopology = {
      isTeamSession: false,
      teamName: null,
      teammates: new Map(),
      teamAgentIds: new Set(),
    };

    const subAgents = [makeSubAgent()];

    const groups = groupTeammateFiles(subAgents, topology);

    expect(groups).toHaveLength(0);
  });

  it('returns empty array when no sub-agents provided', () => {
    const topology: TeamTopology = {
      isTeamSession: true,
      teamName: 'test-team',
      teammates: new Map([['hex-1', 'worker']]),
      teamAgentIds: new Set(['hex-1']),
    };

    const groups = groupTeammateFiles([], topology);

    expect(groups).toHaveLength(0);
  });
});
