/**
 * Detection of sub-agent spawn (brief) and return (debrief) points.
 *
 * Brief points: Where a parent chunk spawns a sub-agent
 * Debrief points: Where sub-agent results return to the parent
 *
 * These create graph fork/join topology:
 * Main: D1 ─T─> D2 ─[BRIEF]─┬─> SubAgent1: D_s1 ─T─> D_s2 ─[DEBRIEF]─┐
 *                           │                                         │
 *                           └─> SubAgent2: D_s3 ─T─> D_s4 ─[DEBRIEF]─┴─> D5 ─T─> D6
 */

import type { Turn, ContentBlock, ToolUseBlock, RawMessage } from '../parser/types.js';
import type { Chunk } from '../parser/types.js';
import type { VectorClock } from '../temporal/vector-clock.js';

/**
 * A brief point marks where a sub-agent is spawned.
 */
export interface BriefPoint {
  /** ID of the parent chunk that spawned the sub-agent */
  parentChunkId: string;
  /** ID of the spawned sub-agent */
  agentId: string;
  /** Vector clock at spawn time */
  clock: VectorClock;
  /** Turn index where spawn occurred */
  turnIndex: number;
  /** Spawn depth (0 = main, 1 = first sub-agent level, etc.) */
  spawnDepth: number;
}

/**
 * A debrief point marks where sub-agent results return to parent.
 */
export interface DebriefPoint {
  /** ID of the sub-agent that completed */
  agentId: string;
  /** IDs of the sub-agent's final chunk(s) */
  agentFinalChunkIds: string[];
  /** ID of the parent chunk that receives the results */
  parentChunkId: string;
  /** Vector clock at debrief time */
  clock: VectorClock;
  /** Turn index where debrief occurred */
  turnIndex: number;
  /** Spawn depth of the sub-agent */
  spawnDepth: number;
}

/**
 * Tool names that indicate sub-agent spawning.
 */
const SPAWN_TOOL_NAMES = new Set(['Task', 'Agent', 'SubAgent']);

/**
 * Mapping of Task tool_use_id → real agentId from agent_progress messages.
 * Built from progress messages in the session.
 */
interface AgentSpawnInfo {
  agentId: string;
  toolUseId: string;
  turnIndex: number;
}

/**
 * Extract agent spawn mappings from progress messages.
 * These messages link Task tool_use IDs to real sub-agent IDs.
 */
function extractAgentSpawns(turns: Turn[]): Map<string, AgentSpawnInfo> {
  const spawns = new Map<string, AgentSpawnInfo>();

  for (const turn of turns) {
    for (const msg of turn.rawMessages) {
      // Look for progress messages with agent_progress data
      if (msg.type !== 'progress') continue;
      if (!msg.data || msg.data.type !== 'agent_progress') continue;

      const agentId = msg.data.agentId as string | undefined;
      const parentToolUseId = msg.parentToolUseID;

      if (agentId && parentToolUseId && !spawns.has(agentId)) {
        spawns.set(agentId, {
          agentId,
          toolUseId: parentToolUseId,
          turnIndex: turn.index,
        });
      }
    }
  }

  return spawns;
}

/**
 * Find which turn contains a Task tool_use with the given ID.
 */
function findTurnForToolUse(turns: Turn[], toolUseId: string): number {
  for (const turn of turns) {
    for (const block of turn.assistantBlocks) {
      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseBlock;
        if (toolUse.id === toolUseId && SPAWN_TOOL_NAMES.has(toolUse.name)) {
          return turn.index;
        }
      }
    }
  }
  return -1;
}

/**
 * Detect brief points from main session turns.
 * Uses agent_progress messages to find real sub-agent IDs.
 *
 * @param turns - Turns from the main session
 * @param chunkIdsByTurn - Map of turn index → chunk IDs created from that turn
 * @param currentClock - Current vector clock at start of processing
 * @param spawnDepth - Current spawn depth (0 for main session)
 * @returns Array of detected brief points
 */
export function detectBriefPoints(
  turns: Turn[],
  chunkIdsByTurn: Map<number, string[]>,
  currentClock: VectorClock,
  spawnDepth: number = 0
): BriefPoint[] {
  const briefPoints: BriefPoint[] = [];

  // Extract real agent spawns from progress messages
  const agentSpawns = extractAgentSpawns(turns);

  for (const [agentId, spawnInfo] of agentSpawns) {
    // Find which turn contains the Task tool that spawned this agent
    const spawnTurnIndex = findTurnForToolUse(turns, spawnInfo.toolUseId);
    if (spawnTurnIndex === -1) continue;

    // Get chunk ID(s) for the spawn turn
    const chunkIds = chunkIdsByTurn.get(spawnTurnIndex);
    if (!chunkIds || chunkIds.length === 0) continue;

    // Use the first chunk as the parent (if turn spans multiple chunks)
    const parentChunkId = chunkIds[0];

    briefPoints.push({
      parentChunkId,
      agentId,
      clock: { ...currentClock },
      turnIndex: spawnTurnIndex,
      spawnDepth,
    });
  }

  return briefPoints;
}

/**
 * Extract spawned agent IDs from a turn (legacy fallback).
 * Uses agent_progress messages if available, otherwise falls back to tool input.
 */
function extractSpawnedAgentIds(turn: Turn): string[] {
  const agentIds: string[] = [];

  // First try: Look for agent_progress messages
  for (const msg of turn.rawMessages) {
    if (msg.type === 'progress' && msg.data?.type === 'agent_progress') {
      const agentId = msg.data.agentId as string | undefined;
      if (agentId && !agentIds.includes(agentId)) {
        agentIds.push(agentId);
      }
    }
  }

  if (agentIds.length > 0) return agentIds;

  // Fallback: Try to extract from tool input
  for (const block of turn.assistantBlocks) {
    if (block.type !== 'tool_use') continue;

    const toolUse = block as ToolUseBlock;
    if (!SPAWN_TOOL_NAMES.has(toolUse.name)) continue;

    // Try to extract agent ID from tool input
    const input = toolUse.input;

    // Common patterns for agent ID in tool input
    if (typeof input === 'object' && input !== null) {
      // Check for subagent_type, agent_id, or similar fields
      const potentialIdFields = ['subagent_type', 'agent_id', 'agentId', 'agent_type'];
      for (const field of potentialIdFields) {
        if (field in input && typeof (input as Record<string, unknown>)[field] === 'string') {
          agentIds.push((input as Record<string, unknown>)[field] as string);
          break;
        }
      }

      // If no explicit ID, use the tool_use_id as a fallback
      if (agentIds.length === 0) {
        agentIds.push(toolUse.id);
      }
    }
  }

  return agentIds;
}

/**
 * Detect debrief points by matching sub-agent completions to parent turns.
 *
 * @param mainTurns - Turns from the main session
 * @param subAgentChunks - Map of agent ID → chunks from that agent
 * @param mainChunks - Chunks from the main session
 * @param chunkIdsByTurn - Map of turn index → chunk IDs
 * @param currentClock - Current vector clock
 * @param spawnDepth - Spawn depth of sub-agents
 * @returns Array of detected debrief points
 */
export function detectDebriefPoints(
  mainTurns: Turn[],
  subAgentChunks: Map<string, Chunk[]>,
  mainChunks: Chunk[],
  chunkIdsByTurn: Map<number, string[]>,
  currentClock: VectorClock,
  spawnDepth: number = 1
): DebriefPoint[] {
  const debriefPoints: DebriefPoint[] = [];

  // For each sub-agent, find where its results are used in the main session
  for (const [agentId, chunks] of subAgentChunks) {
    if (chunks.length === 0) continue;

    // Get the final chunk(s) from this sub-agent
    // (could be multiple if agent was split into chunks)
    const finalChunk = chunks[chunks.length - 1];
    const finalChunkIds = [finalChunk.id];

    // Find the turn that follows sub-agent completion
    // This is typically the turn that uses the sub-agent's results
    const debriefTurnIndex = findDebriefTurn(mainTurns, agentId, finalChunk);

    if (debriefTurnIndex === -1) {
      // If no explicit debrief found, link to the next main chunk after spawn
      // Find the brief point for this agent
      for (let i = 0; i < mainTurns.length; i++) {
        const turn = mainTurns[i];
        if (extractSpawnedAgentIds(turn).includes(agentId)) {
          // Link to the next turn's chunk
          const nextChunkIds = chunkIdsByTurn.get(i + 1);
          if (nextChunkIds && nextChunkIds.length > 0) {
            debriefPoints.push({
              agentId,
              agentFinalChunkIds: finalChunkIds,
              parentChunkId: nextChunkIds[0],
              clock: { ...currentClock },
              turnIndex: i + 1,
              spawnDepth,
            });
          }
          break;
        }
      }
      continue;
    }

    // Get chunk ID for the debrief turn
    const debriefChunkIds = chunkIdsByTurn.get(debriefTurnIndex);
    if (!debriefChunkIds || debriefChunkIds.length === 0) continue;

    debriefPoints.push({
      agentId,
      agentFinalChunkIds: finalChunkIds,
      parentChunkId: debriefChunkIds[0],
      clock: { ...currentClock },
      turnIndex: debriefTurnIndex,
      spawnDepth,
    });
  }

  return debriefPoints;
}

/**
 * Find the turn index where sub-agent results are debriefed.
 * Looks for tool results or references to the sub-agent's output.
 */
function findDebriefTurn(
  turns: Turn[],
  agentId: string,
  finalChunk: Chunk
): number {
  // Strategy 1: Look for turns with tool results that explicitly mention this agent
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    // Check tool exchanges for results mentioning this specific agent
    for (const exchange of turn.toolExchanges) {
      if (exchange.toolName === 'Task' || exchange.toolName === 'Agent') {
        // Only match if the result explicitly contains this agent's ID
        // (removed isTaskResult fallback - it's too broad and matches unrelated agents)
        if (exchange.result.includes(agentId)) {
          return i;
        }
      }
    }

    // Check raw messages for debrief patterns
    for (const msg of turn.rawMessages) {
      if (msg.type === 'user' && msg.message?.content) {
        const content = msg.message.content;
        if (typeof content === 'string' && content.includes(agentId)) {
          return i;
        }
      }
    }
  }

  // Strategy 2: If sub-agent spawned in turn N, debrief is likely in turn N+1 or N+2
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (extractSpawnedAgentIds(turn).includes(agentId)) {
      // Return the next turn if it exists
      if (i + 1 < turns.length) {
        return i + 1;
      }
    }
  }

  return -1;
}


/**
 * Build a map of turn index → chunk IDs for efficient lookup.
 */
export function buildChunkIdsByTurn(chunks: Chunk[]): Map<number, string[]> {
  const map = new Map<number, string[]>();

  for (const chunk of chunks) {
    for (const turnIndex of chunk.metadata.turnIndices) {
      const existing = map.get(turnIndex) ?? [];
      existing.push(chunk.id);
      map.set(turnIndex, existing);
    }
  }

  return map;
}
