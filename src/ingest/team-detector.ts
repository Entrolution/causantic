/**
 * Team topology detection for agent team sessions.
 *
 * Detects whether a session uses agent teams by scanning for:
 * - TeamCreate tool calls (explicit team creation)
 * - Task tool calls with team_name (team member spawning)
 * - SendMessage tool calls (inter-agent messaging)
 *
 * Resolves hex agent IDs to human-readable teammate names and
 * groups multi-file teammates for consolidated ingestion.
 */

import type { Turn, ToolUseBlock } from '../parser/types.js';
import type { SubAgentInfo } from '../parser/session-reader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('team-detector');

/**
 * Detected team topology for a session.
 */
export interface TeamTopology {
  /** Whether this session uses agent teams */
  isTeamSession: boolean;
  /** Name of the team (from TeamCreate), or null */
  teamName: string | null;
  /** Map of hex agent ID → human-readable name */
  teammates: Map<string, string>;
  /** Set of hex IDs that belong to the team (vs regular sub-agents) */
  teamAgentIds: Set<string>;
}

/**
 * A group of files belonging to one teammate.
 */
export interface TeammateFileGroup {
  /** Human-readable teammate name */
  humanName: string;
  /** Sub-agent files for this teammate, ordered by first message timestamp */
  files: SubAgentInfo[];
}

/**
 * Detect team topology from main session turns and sub-agent info.
 *
 * Scans assistant blocks for TeamCreate, Task (with team_name), and
 * SendMessage tool calls. Resolves hex IDs to human names using a
 * priority chain: Task.name > Task result parsing > SendMessage routing > XML fallback.
 */
export function detectTeamTopology(mainTurns: Turn[], subAgents: SubAgentInfo[]): TeamTopology {
  let teamName: string | null = null;
  const teammates = new Map<string, string>(); // hexId -> humanName
  const teamAgentIds = new Set<string>();
  let hasTeamSignals = false;

  // Build a set of known sub-agent hex IDs for matching
  const knownHexIds = new Set(subAgents.map((sa) => sa.agentId));

  // Track Task tool calls with team_name for name resolution
  const taskToolUseIds = new Map<string, string>(); // toolUseId -> humanName from input.name

  for (const turn of mainTurns) {
    for (const block of turn.assistantBlocks) {
      if (block.type !== 'tool_use') continue;
      const toolUse = block as ToolUseBlock;

      // 1. TeamCreate — extract team name
      if (toolUse.name === 'TeamCreate') {
        const input = toolUse.input as Record<string, unknown>;
        if (typeof input.team_name === 'string') {
          teamName = input.team_name;
          hasTeamSignals = true;
          log.debug('Detected TeamCreate', { teamName });
        }
        continue;
      }

      // 2. Task with team_name — team member spawn
      if (toolUse.name === 'Task') {
        const input = toolUse.input as Record<string, unknown>;
        if (typeof input.team_name === 'string') {
          hasTeamSignals = true;
          const humanName = typeof input.name === 'string' ? input.name : null;

          if (humanName) {
            taskToolUseIds.set(toolUse.id, humanName);
          }

          // Try to resolve hex ID from tool exchange results
          const exchange = turn.toolExchanges.find((e) => e.toolUseId === toolUse.id);
          if (exchange) {
            const hexId = resolveHexIdFromResult(exchange.result, knownHexIds);
            if (hexId && humanName) {
              teammates.set(hexId, humanName);
              teamAgentIds.add(hexId);
              log.debug('Resolved teammate from Task result', { hexId, humanName });
            }
          }
        }
        continue;
      }

      // 3. SendMessage — inter-agent messaging signal
      if (toolUse.name === 'SendMessage') {
        hasTeamSignals = true;
        // SendMessage results may contain sender routing metadata
        const exchange = turn.toolExchanges.find((e) => e.toolUseId === toolUse.id);
        if (exchange) {
          const senderInfo = parseSenderFromResult(exchange.result);
          if (senderInfo && knownHexIds.has(senderInfo.hexId)) {
            teamAgentIds.add(senderInfo.hexId);
            if (senderInfo.name && !teammates.has(senderInfo.hexId)) {
              teammates.set(senderInfo.hexId, senderInfo.name);
            }
          }
        }
      }
    }

    // 4. Fallback: Parse <teammate-message> XML tags in user messages
    if (hasTeamSignals) {
      parseTeammateMessagesFromTurn(turn, knownHexIds, teammates, teamAgentIds);
    }
  }

  // If we have team signals but some agent IDs are still unresolved,
  // try to infer from sub-agent files that match known patterns
  if (hasTeamSignals && teammates.size > 0) {
    resolveRemainingAgentIds(subAgents, teammates, teamAgentIds, taskToolUseIds, mainTurns);
  }

  return {
    isTeamSession: hasTeamSignals,
    teamName,
    teammates,
    teamAgentIds,
  };
}

/**
 * Try to extract a hex agent ID from a Task tool result.
 *
 * Task results may contain "name@description" format or reference the agent ID directly.
 */
function resolveHexIdFromResult(result: string, knownHexIds: Set<string>): string | null {
  // Check if result directly contains a known hex ID
  for (const hexId of knownHexIds) {
    if (result.includes(hexId)) {
      return hexId;
    }
  }

  return null;
}

/**
 * Parse sender routing metadata from SendMessage result text.
 */
function parseSenderFromResult(result: string): { hexId: string; name: string | null } | null {
  // Look for sender field in result
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === 'object' && parsed !== null) {
      const sender = (parsed as Record<string, unknown>).sender;
      if (typeof sender === 'string') {
        return { hexId: sender, name: null };
      }
    }
  } catch {
    // Not JSON, try regex patterns
  }

  // Look for patterns like sender: "hexId" or from: "hexId"
  const senderMatch = result.match(/(?:sender|from)["':\s]+([a-f0-9-]{8,})/i);
  if (senderMatch) {
    return { hexId: senderMatch[1], name: null };
  }

  return null;
}

/**
 * Parse <teammate-message> XML tags from user messages in a turn.
 * Format: <teammate-message teammate_id="name" summary="...">
 */
function parseTeammateMessagesFromTurn(
  turn: Turn,
  knownHexIds: Set<string>,
  teammates: Map<string, string>,
  teamAgentIds: Set<string>,
): void {
  for (const msg of turn.rawMessages) {
    if (msg.type !== 'user' || !msg.message?.content) continue;

    const content =
      typeof msg.message.content === 'string'
        ? msg.message.content
        : msg.message.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('\n');

    // Match <teammate-message teammate_id="name">
    const tmRegex = /<teammate-message\s+teammate_id="([^"]+)"/g;
    let match;
    while ((match = tmRegex.exec(content)) !== null) {
      const teammateId = match[1];
      // teammate_id is the human name — map it to hex IDs via other signals
      // This acts as a fallback name source: if we see a teammate_id that
      // matches a name we already know, it confirms it.
      // If we see a new name, store it for later resolution.
      for (const [hexId, name] of teammates) {
        if (name === teammateId) {
          teamAgentIds.add(hexId);
        }
      }
    }
  }
}

/**
 * Attempt to resolve remaining unmatched agent IDs.
 *
 * Uses progress messages and cross-referencing to map hex IDs
 * that weren't resolved from Task tool results.
 */
function resolveRemainingAgentIds(
  subAgents: SubAgentInfo[],
  teammates: Map<string, string>,
  teamAgentIds: Set<string>,
  taskToolUseIds: Map<string, string>,
  mainTurns: Turn[],
): void {
  // Extract agent spawns from progress messages (same pattern as brief-debrief-detector)
  for (const turn of mainTurns) {
    for (const msg of turn.rawMessages) {
      if (msg.type !== 'progress') continue;
      if (!msg.data || msg.data.type !== 'agent_progress') continue;

      const agentId = msg.data.agentId as string | undefined;
      const parentToolUseId = msg.parentToolUseID;

      if (agentId && parentToolUseId && !teammates.has(agentId)) {
        // Check if this toolUseId maps to a known team Task spawn
        const humanName = taskToolUseIds.get(parentToolUseId);
        if (humanName) {
          teammates.set(agentId, humanName);
          teamAgentIds.add(agentId);
          log.debug('Resolved teammate via progress message', { agentId, humanName });
        }
      }
    }
  }

  // For any sub-agents that are in teamAgentIds but don't have a name,
  // assign a fallback name based on index
  let unnamedCount = 0;
  for (const sa of subAgents) {
    if (teamAgentIds.has(sa.agentId) && !teammates.has(sa.agentId)) {
      unnamedCount++;
      teammates.set(sa.agentId, `teammate-${unnamedCount}`);
      log.debug('Assigned fallback name to teammate', {
        agentId: sa.agentId,
        name: `teammate-${unnamedCount}`,
      });
    }
  }
}

/**
 * Group sub-agent files by resolved teammate name.
 *
 * Only includes files that belong to the team (in teamAgentIds).
 * Filters out dead-end files. Groups multiple files per teammate
 * when a teammate has been respawned.
 */
export function groupTeammateFiles(
  subAgents: SubAgentInfo[],
  topology: TeamTopology,
): TeammateFileGroup[] {
  const groups = new Map<string, SubAgentInfo[]>();

  for (const sa of subAgents) {
    // Skip non-team agents
    if (!topology.teamAgentIds.has(sa.agentId)) continue;
    // Skip dead ends
    if (sa.isDeadEnd) continue;

    const humanName = topology.teammates.get(sa.agentId) ?? sa.agentId;
    const existing = groups.get(humanName) ?? [];
    existing.push(sa);
    groups.set(humanName, existing);
  }

  const result: TeammateFileGroup[] = [];
  for (const [humanName, files] of groups) {
    result.push({ humanName, files });
  }

  log.debug('Grouped teammate files', {
    groupCount: result.length,
    groups: result.map((g) => `${g.humanName}: ${g.files.length} files`),
  });

  return result;
}
