/**
 * Clock compaction for reference clocks.
 *
 * Reference clocks accumulate agent entries over time. This module provides
 * compaction to prune entries only when ALL edges referencing that agent
 * have fully decayed.
 *
 * Why not prune by tick recency:
 * An agent may not tick for a long time, but edges referencing it could still
 * be queried. Pruning based on tick recency would break hop count calculation
 * for those edges.
 */

import { getDb } from '../storage/db.js';
import {
  getReferenceClock,
  setReferenceClock,
  getAllAgentClocks,
} from '../storage/clock-store.js';
import {
  type VectorClock,
  hopCount,
  deserialize,
} from './vector-clock.js';
import { type VectorDecayConfig, DEFAULT_VECTOR_DECAY } from '../storage/decay.js';
import { getConfig } from '../config/memory-config.js';

/**
 * Result of clock compaction.
 */
export interface CompactionResult {
  /** Agent IDs that were pruned */
  prunedAgents: string[];
  /** Number of agent entries remaining */
  remainingAgents: number;
  /** Duration of compaction in milliseconds */
  durationMs: number;
}

/**
 * Compact the reference clock for a project by removing agent entries
 * that no longer have any live edges referencing them.
 *
 * @param projectSlug - Project identifier
 * @param vectorConfig - Vector decay configuration (optional)
 * @returns Compaction result
 */
export async function compactReferenceClock(
  projectSlug: string,
  vectorConfig?: VectorDecayConfig
): Promise<CompactionResult> {
  const startTime = Date.now();
  const config = vectorConfig ?? getConfig().vectorDecay ?? DEFAULT_VECTOR_DECAY;

  const refClock = getReferenceClock(projectSlug);
  const agentIds = Object.keys(refClock);

  if (agentIds.length === 0) {
    return {
      prunedAgents: [],
      remainingAgents: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const prunedAgents: string[] = [];

  for (const agentId of agentIds) {
    const hasLiveEdges = await hasEdgesReferencingAgent(projectSlug, agentId, refClock, config);

    if (!hasLiveEdges) {
      prunedAgents.push(agentId);
    }
  }

  if (prunedAgents.length > 0) {
    // Remove pruned agents from reference clock
    const newClock: VectorClock = {};
    for (const [id, ticks] of Object.entries(refClock)) {
      if (!prunedAgents.includes(id)) {
        newClock[id] = ticks;
      }
    }
    setReferenceClock(projectSlug, newClock);
  }

  return {
    prunedAgents,
    remainingAgents: agentIds.length - prunedAgents.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Check if any live edges reference a specific agent in their vector clock.
 *
 * @param projectSlug - Project identifier
 * @param agentId - Agent ID to check
 * @param refClock - Current reference clock
 * @param config - Vector decay configuration
 * @returns true if at least one live edge references this agent
 */
async function hasEdgesReferencingAgent(
  projectSlug: string,
  agentId: string,
  refClock: VectorClock,
  config: VectorDecayConfig
): Promise<boolean> {
  const db = getDb();

  // Find edges in this project whose vector_clock contains this agentId
  // We use LIKE to find JSON containing the agent ID
  const rows = db.prepare(`
    SELECT e.vector_clock FROM edges e
    JOIN chunks c ON e.source_chunk_id = c.id
    WHERE c.session_slug = ?
      AND e.vector_clock LIKE ?
  `).all(projectSlug, `%"${agentId}":%`) as Array<{ vector_clock: string }>;

  for (const row of rows) {
    if (!row.vector_clock) continue;

    const edgeClock = deserialize(row.vector_clock);
    if (!(agentId in edgeClock)) continue;

    // Calculate if edge is still alive
    const hops = hopCount(edgeClock, refClock);
    const weight = Math.pow(config.weightPerHop, hops);

    if (weight >= config.minWeight) {
      return true; // At least one live edge references this agent
    }
  }

  return false; // No live edges reference this agent
}

/**
 * Get statistics about clock entries for a project.
 *
 * @param projectSlug - Project identifier
 * @returns Clock statistics
 */
export function getClockStats(projectSlug: string): {
  agentCount: number;
  totalTicks: number;
  agents: Array<{ agentId: string; ticks: number }>;
} {
  const refClock = getReferenceClock(projectSlug);
  const agents = Object.entries(refClock).map(([agentId, ticks]) => ({
    agentId,
    ticks,
  }));

  return {
    agentCount: agents.length,
    totalTicks: agents.reduce((sum, a) => sum + a.ticks, 0),
    agents: agents.sort((a, b) => b.ticks - a.ticks),
  };
}

/**
 * Estimate the "age" of edges in hop count terms.
 * Returns distribution of edges by hop count.
 *
 * @param projectSlug - Project identifier
 * @returns Histogram of hop counts
 */
export async function getHopCountDistribution(
  projectSlug: string
): Promise<Map<number, number>> {
  const db = getDb();
  const refClock = getReferenceClock(projectSlug);
  const distribution = new Map<number, number>();

  const rows = db.prepare(`
    SELECT e.vector_clock FROM edges e
    JOIN chunks c ON e.source_chunk_id = c.id
    WHERE c.session_slug = ?
      AND e.vector_clock IS NOT NULL
  `).all(projectSlug) as Array<{ vector_clock: string }>;

  for (const row of rows) {
    if (!row.vector_clock) continue;

    const edgeClock = deserialize(row.vector_clock);
    const hops = hopCount(edgeClock, refClock);

    distribution.set(hops, (distribution.get(hops) ?? 0) + 1);
  }

  return distribution;
}

/**
 * Force refresh the reference clock by merging all agent clocks.
 * Useful after data recovery or manual edits.
 *
 * @param projectSlug - Project identifier
 * @returns The refreshed reference clock
 */
export function refreshReferenceClock(projectSlug: string): VectorClock {
  const agentClocks = getAllAgentClocks(projectSlug);
  const refClock: VectorClock = {};

  for (const [, clock] of agentClocks) {
    for (const [agentId, ticks] of Object.entries(clock)) {
      refClock[agentId] = Math.max(refClock[agentId] ?? 0, ticks);
    }
  }

  setReferenceClock(projectSlug, refClock);
  return refClock;
}
