/**
 * Team edge detection for agent team sessions.
 *
 * Detects three types of edges between team members:
 * - team-spawn: Lead spawns a teammate (Task with team_name)
 * - peer-message: Teammate sends a message to another teammate (SendMessage)
 * - team-report: Teammate sends results back to the lead (SendMessage to lead)
 *
 * Matching uses tool call metadata and falls back to timestamp proximity.
 */

import type { Turn, ToolUseBlock } from '../parser/types.js';
import type { ChunkInput } from '../storage/types.js';
import type { TeamTopology } from './team-detector.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('team-edge-detector');

/** Timestamp proximity window for fallback matching (30 seconds). */
const TIMESTAMP_PROXIMITY_MS = 30_000;

/**
 * A detected edge point between team members.
 */
export interface TeamEdgePoint {
  /** Agent ID of the sender */
  sourceAgentId: string;
  /** Agent ID of the receiver */
  targetAgentId: string;
  /** Chunk IDs from the source agent for this edge */
  sourceChunkIds: string[];
  /** Chunk IDs from the target agent for this edge */
  targetChunkIds: string[];
  /** Type of team edge */
  edgeType: 'team-spawn' | 'team-report' | 'peer-message';
  /** ISO timestamp of the event */
  timestamp: string;
}

/**
 * Find the chunk containing a specific turn index.
 */
function findChunkForTurn(chunks: ChunkInput[], turnIndex: number): ChunkInput | undefined {
  return chunks.find((c) => c.turnIndices.includes(turnIndex));
}

/**
 * Find the chunk closest to a timestamp.
 */
function findChunkNearTimestamp(
  chunks: ChunkInput[],
  timestamp: string,
  windowMs: number,
): ChunkInput | undefined {
  const targetMs = new Date(timestamp).getTime();
  let bestChunk: ChunkInput | undefined;
  let bestDist = Infinity;

  for (const chunk of chunks) {
    const startMs = new Date(chunk.startTime).getTime();
    const endMs = new Date(chunk.endTime).getTime();
    const dist = Math.min(Math.abs(startMs - targetMs), Math.abs(endMs - targetMs));

    if (dist < bestDist && dist <= windowMs) {
      bestDist = dist;
      bestChunk = chunk;
    }
  }

  return bestChunk;
}

/**
 * Detect team edges from session data.
 *
 * Scans main session for team-spawn events (Task with team_name)
 * and agent files for peer-message/team-report events (SendMessage).
 *
 * @param mainTurns - Turns from the main (lead) session
 * @param mainChunks - Chunks from the main session
 * @param agentData - Map of agentId/humanName → { turns, chunks } for each teammate
 * @param topology - Detected team topology
 * @returns Array of team edge points
 */
export function detectTeamEdges(
  mainTurns: Turn[],
  mainChunks: ChunkInput[],
  agentData: Map<string, { turns: Turn[]; chunks: ChunkInput[] }>,
  topology: TeamTopology,
): TeamEdgePoint[] {
  const edges: TeamEdgePoint[] = [];

  // 1. Detect team-spawn edges (lead → teammate)
  detectTeamSpawnEdges(mainTurns, mainChunks, agentData, topology, edges);

  // 2. Detect peer-message and team-report edges (agent → agent or agent → lead)
  detectMessageEdges(mainTurns, mainChunks, agentData, topology, edges);

  log.debug('Detected team edges', {
    total: edges.length,
    spawn: edges.filter((e) => e.edgeType === 'team-spawn').length,
    report: edges.filter((e) => e.edgeType === 'team-report').length,
    peer: edges.filter((e) => e.edgeType === 'peer-message').length,
  });

  return edges;
}

/**
 * Detect team-spawn edges: lead spawns teammate via Task tool with team_name.
 */
function detectTeamSpawnEdges(
  mainTurns: Turn[],
  mainChunks: ChunkInput[],
  agentData: Map<string, { turns: Turn[]; chunks: ChunkInput[] }>,
  topology: TeamTopology,
  edges: TeamEdgePoint[],
): void {
  for (let ti = 0; ti < mainTurns.length; ti++) {
    const turn = mainTurns[ti];

    for (const block of turn.assistantBlocks) {
      if (block.type !== 'tool_use') continue;
      const toolUse = block as ToolUseBlock;

      if (toolUse.name !== 'Task') continue;
      const input = toolUse.input as Record<string, unknown>;
      if (typeof input.team_name !== 'string') continue;

      // Find which teammate this spawned
      const humanName = typeof input.name === 'string' ? input.name : null;
      if (!humanName) continue;

      // Find source chunk (lead's chunk containing this turn)
      const sourceChunk = findChunkForTurn(mainChunks, turn.index);
      if (!sourceChunk) continue;

      // Find target chunk (teammate's first chunk)
      const targetData = agentData.get(humanName);
      if (!targetData || targetData.chunks.length === 0) continue;

      const targetChunk = targetData.chunks[0];

      edges.push({
        sourceAgentId: 'lead',
        targetAgentId: humanName,
        sourceChunkIds: [sourceChunk.id],
        targetChunkIds: [targetChunk.id],
        edgeType: 'team-spawn',
        timestamp: turn.startTime,
      });
    }
  }
}

/**
 * Detect peer-message and team-report edges from SendMessage calls in agent files.
 */
function detectMessageEdges(
  mainTurns: Turn[],
  mainChunks: ChunkInput[],
  agentData: Map<string, { turns: Turn[]; chunks: ChunkInput[] }>,
  topology: TeamTopology,
  edges: TeamEdgePoint[],
): void {
  for (const [senderName, senderData] of agentData) {
    for (let ti = 0; ti < senderData.turns.length; ti++) {
      const turn = senderData.turns[ti];

      for (const block of turn.assistantBlocks) {
        if (block.type !== 'tool_use') continue;
        const toolUse = block as ToolUseBlock;
        if (toolUse.name !== 'SendMessage') continue;

        const input = toolUse.input as Record<string, unknown>;
        const recipientName = typeof input.recipient === 'string' ? input.recipient : null;
        const summary = typeof input.summary === 'string' ? input.summary : null;
        if (!recipientName) continue;

        // Find source chunk in sender's data
        const sourceChunk = findChunkForTurn(senderData.chunks, turn.index);
        if (!sourceChunk) continue;

        // Determine if this is a team-report (to lead) or peer-message
        const isToLead = recipientName === 'team-lead' || recipientName === 'lead';
        const edgeType = isToLead ? 'team-report' : 'peer-message';

        // Find target chunk
        let targetChunk: ChunkInput | undefined;

        if (isToLead) {
          // team-report: find matching <teammate-message> in main turns
          targetChunk = findReceiveChunkInMain(
            mainTurns,
            mainChunks,
            senderName,
            summary,
            turn.startTime,
          );
        } else {
          // peer-message: find matching receive in target agent's data
          const targetData = agentData.get(recipientName);
          if (targetData) {
            targetChunk = findReceiveChunkInAgent(
              targetData.turns,
              targetData.chunks,
              senderName,
              summary,
              turn.startTime,
            );
          }
        }

        if (!targetChunk) continue;

        const targetAgentId = isToLead ? 'lead' : recipientName;

        edges.push({
          sourceAgentId: senderName,
          targetAgentId,
          sourceChunkIds: [sourceChunk.id],
          targetChunkIds: [targetChunk.id],
          edgeType,
          timestamp: turn.startTime,
        });
      }
    }
  }
}

/**
 * Find the chunk in main session that received a teammate message.
 *
 * Matches by <teammate-message> XML tag with matching teammate_id and summary,
 * falling back to timestamp proximity.
 */
function findReceiveChunkInMain(
  mainTurns: Turn[],
  mainChunks: ChunkInput[],
  senderName: string,
  summary: string | null,
  sendTimestamp: string,
): ChunkInput | undefined {
  // Try exact match via <teammate-message> XML
  for (let ti = 0; ti < mainTurns.length; ti++) {
    const turn = mainTurns[ti];
    if (matchesTeammateMessage(turn, senderName, summary)) {
      const chunk = findChunkForTurn(mainChunks, turn.index);
      if (chunk) return chunk;
    }
  }

  // Fallback: timestamp proximity
  return findChunkNearTimestamp(mainChunks, sendTimestamp, TIMESTAMP_PROXIMITY_MS);
}

/**
 * Find the chunk in a teammate's session that received a message.
 *
 * Matches by <teammate-message> XML tag, falling back to timestamp proximity.
 */
function findReceiveChunkInAgent(
  turns: Turn[],
  chunks: ChunkInput[],
  senderName: string,
  summary: string | null,
  sendTimestamp: string,
): ChunkInput | undefined {
  // Try exact match via <teammate-message> XML
  for (let ti = 0; ti < turns.length; ti++) {
    const turn = turns[ti];
    if (matchesTeammateMessage(turn, senderName, summary)) {
      const chunk = findChunkForTurn(chunks, turn.index);
      if (chunk) return chunk;
    }
  }

  // Fallback: timestamp proximity
  return findChunkNearTimestamp(chunks, sendTimestamp, TIMESTAMP_PROXIMITY_MS);
}

/**
 * Check if a turn contains a <teammate-message> from the given sender.
 */
function matchesTeammateMessage(turn: Turn, senderName: string, summary: string | null): boolean {
  for (const msg of turn.rawMessages) {
    if (msg.type !== 'user' || !msg.message?.content) continue;

    const content =
      typeof msg.message.content === 'string'
        ? msg.message.content
        : msg.message.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('\n');

    // Check for <teammate-message teammate_id="senderName" summary="...">
    const escaped = senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<teammate-message\\s+teammate_id="${escaped}"`, 'i');
    if (regex.test(content)) {
      // If summary provided, also check it matches
      if (summary) {
        const summaryEscaped = summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const summaryRegex = new RegExp(`summary="${summaryEscaped}"`, 'i');
        if (summaryRegex.test(content)) return true;
        // Even without summary match, teammate_id match is good enough
      }
      return true;
    }
  }
  return false;
}
