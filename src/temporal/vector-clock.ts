/**
 * Vector clock implementation for D-T-D memory graph.
 *
 * Vector clocks capture logical causal distance (D-T-D hop count) instead of
 * physical time. This is more meaningful for memory retrieval - especially
 * with parallel sub-agents.
 *
 * Semantics:
 * - Domain: Per-project (each project has its own clock set)
 * - Entries: Per-agent (main UI agent, human, each sub-agent)
 * - Tick: Each D-T-D cycle (turn) increments that agent's clock entry
 * - Reference clock: Element-wise max of all agent clocks
 */

/**
 * A vector clock maps agent IDs to their tick counts.
 */
export interface VectorClock {
  [agentId: string]: number;
}

/** Main UI agent identifier */
export const MAIN_AGENT_ID = 'ui';

/** Human user agent identifier */
export const HUMAN_AGENT_ID = 'human';

/**
 * Create an empty vector clock.
 */
export function createClock(): VectorClock {
  return {};
}

/**
 * Increment the tick count for a specific agent.
 * Returns a new clock (immutable operation).
 *
 * @param clock - Current vector clock
 * @param agentId - Agent to increment
 * @returns New vector clock with incremented tick
 */
export function tick(clock: VectorClock, agentId: string): VectorClock {
  return { ...clock, [agentId]: (clock[agentId] ?? 0) + 1 };
}

/**
 * Merge two vector clocks by taking the element-wise maximum.
 * Used when:
 * - Sub-agent inherits parent clock at spawn
 * - Parent merges sub-agent clock at debrief
 * - Computing reference clock from all agent clocks
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns Merged vector clock with max of each entry
 */
export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result = { ...a };
  for (const [id, ticks] of Object.entries(b)) {
    result[id] = Math.max(result[id] ?? 0, ticks);
  }
  return result;
}

/**
 * Calculate the hop count (logical distance) between an edge's clock
 * and the current reference clock.
 *
 * The hop count is the sum of differences for each agent. This represents
 * how many D-T-D cycles have occurred since the edge was created.
 *
 * @param edgeClock - Vector clock stamped on the edge
 * @param refClock - Current reference clock for the project
 * @returns Total hop count (sum of per-agent differences)
 */
export function hopCount(edgeClock: VectorClock, refClock: VectorClock): number {
  let hops = 0;
  for (const agentId of Object.keys(edgeClock)) {
    hops += Math.max(0, (refClock[agentId] ?? 0) - edgeClock[agentId]);
  }
  return hops;
}

/**
 * Check if clock A happened before clock B.
 * A happened before B if all entries in A are <= entries in B
 * and at least one entry in A is < the corresponding entry in B.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns true if a happened before b
 */
export function happenedBefore(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let hasStrictlyLess = false;

  for (const key of allKeys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;

    if (aVal > bVal) {
      return false; // a has a larger value, so a did not happen before b
    }
    if (aVal < bVal) {
      hasStrictlyLess = true;
    }
  }

  return hasStrictlyLess;
}

/**
 * Check if two clocks are concurrent (neither happened before the other, and not equal).
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns true if clocks are concurrent (not equal and incomparable)
 */
export function areConcurrent(a: VectorClock, b: VectorClock): boolean {
  // First check if they're equal
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let hasAnyDifference = false;
  for (const key of allKeys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) {
      hasAnyDifference = true;
      break;
    }
  }

  if (!hasAnyDifference) {
    return false; // Equal clocks are not concurrent
  }

  return !happenedBefore(a, b) && !happenedBefore(b, a);
}

/**
 * Compare two clocks and return their causal relationship.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns 'before' if a < b, 'after' if a > b, 'concurrent' if neither, 'equal' if same
 */
export function compare(
  a: VectorClock,
  b: VectorClock
): 'before' | 'after' | 'concurrent' | 'equal' {
  if (happenedBefore(a, b)) return 'before';
  if (happenedBefore(b, a)) return 'after';

  // Check if equal
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let isEqual = true;
  for (const key of allKeys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) {
      isEqual = false;
      break;
    }
  }

  return isEqual ? 'equal' : 'concurrent';
}

/**
 * Get the total number of ticks across all agents.
 * Useful for rough ordering when vector clocks are concurrent.
 *
 * @param clock - Vector clock
 * @returns Sum of all tick counts
 */
export function totalTicks(clock: VectorClock): number {
  return Object.values(clock).reduce((sum, t) => sum + t, 0);
}

/**
 * Serialize a vector clock to JSON string for database storage.
 *
 * @param clock - Vector clock to serialize
 * @returns JSON string representation
 */
export function serialize(clock: VectorClock): string {
  return JSON.stringify(clock);
}

/**
 * Deserialize a vector clock from JSON string.
 *
 * @param json - JSON string or null
 * @returns Deserialized vector clock (empty if null or invalid)
 */
export function deserialize(json: string | null | undefined): VectorClock {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    // Validate it's an object with number values
    if (typeof parsed === 'object' && parsed !== null) {
      const clock: VectorClock = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          clock[key] = value;
        }
      }
      return clock;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Clone a vector clock.
 *
 * @param clock - Clock to clone
 * @returns New clock with same values
 */
export function clone(clock: VectorClock): VectorClock {
  return { ...clock };
}

/**
 * Check if a clock is empty (no ticks recorded).
 *
 * @param clock - Vector clock to check
 * @returns true if clock has no entries or all entries are 0
 */
export function isEmpty(clock: VectorClock): boolean {
  const values = Object.values(clock);
  return values.length === 0 || values.every((v) => v === 0);
}

/**
 * Get all agent IDs present in a clock.
 *
 * @param clock - Vector clock
 * @returns Array of agent IDs
 */
export function getAgentIds(clock: VectorClock): string[] {
  return Object.keys(clock).filter((id) => clock[id] > 0);
}
