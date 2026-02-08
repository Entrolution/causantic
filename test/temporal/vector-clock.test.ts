/**
 * Tests for vector clock implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  createClock,
  tick,
  merge,
  hopCount,
  happenedBefore,
  areConcurrent,
  compare,
  totalTicks,
  serialize,
  deserialize,
  clone,
  isEmpty,
  getAgentIds,
  MAIN_AGENT_ID,
  HUMAN_AGENT_ID,
  type VectorClock,
} from '../../src/temporal/vector-clock.js';

describe('vector-clock', () => {
  describe('createClock', () => {
    it('creates an empty clock', () => {
      const clock = createClock();
      expect(clock).toEqual({});
    });
  });

  describe('tick', () => {
    it('increments a new agent entry from 0 to 1', () => {
      const clock = createClock();
      const ticked = tick(clock, 'agent1');
      expect(ticked).toEqual({ agent1: 1 });
    });

    it('increments an existing agent entry', () => {
      const clock = { agent1: 5 };
      const ticked = tick(clock, 'agent1');
      expect(ticked).toEqual({ agent1: 6 });
    });

    it('does not mutate the original clock', () => {
      const clock = { agent1: 3 };
      tick(clock, 'agent1');
      expect(clock).toEqual({ agent1: 3 });
    });

    it('preserves other agent entries', () => {
      const clock = { agent1: 3, agent2: 5 };
      const ticked = tick(clock, 'agent1');
      expect(ticked).toEqual({ agent1: 4, agent2: 5 });
    });
  });

  describe('merge', () => {
    it('merges two empty clocks', () => {
      expect(merge({}, {})).toEqual({});
    });

    it('merges with an empty clock', () => {
      const clock = { agent1: 3, agent2: 5 };
      expect(merge(clock, {})).toEqual({ agent1: 3, agent2: 5 });
      expect(merge({}, clock)).toEqual({ agent1: 3, agent2: 5 });
    });

    it('takes element-wise maximum', () => {
      const a = { agent1: 3, agent2: 5 };
      const b = { agent1: 7, agent2: 2 };
      expect(merge(a, b)).toEqual({ agent1: 7, agent2: 5 });
    });

    it('includes entries from both clocks', () => {
      const a = { agent1: 3 };
      const b = { agent2: 5 };
      expect(merge(a, b)).toEqual({ agent1: 3, agent2: 5 });
    });
  });

  describe('hopCount', () => {
    it('returns 0 for identical clocks', () => {
      const clock = { agent1: 5, agent2: 3 };
      expect(hopCount(clock, clock)).toBe(0);
    });

    it('counts hops correctly for single agent', () => {
      const edge = { ui: 5 };
      const ref = { ui: 10 };
      expect(hopCount(edge, ref)).toBe(5);
    });

    it('sums hops across multiple agents', () => {
      const edge = { ui: 5, human: 3 };
      const ref = { ui: 10, human: 7 };
      // (10-5) + (7-3) = 5 + 4 = 9
      expect(hopCount(edge, ref)).toBe(9);
    });

    it('handles missing agents in reference clock', () => {
      const edge = { ui: 5, subagent: 2 };
      const ref = { ui: 10 };
      // subagent not in ref, so (ref[subagent] ?? 0) - 2 = -2, but max(0, -2) = 0
      // (10-5) + 0 = 5
      expect(hopCount(edge, ref)).toBe(5);
    });

    it('ignores agents not in edge clock', () => {
      const edge = { ui: 5 };
      const ref = { ui: 10, subagent: 3 };
      // Only count ui: 10-5 = 5
      expect(hopCount(edge, ref)).toBe(5);
    });
  });

  describe('happenedBefore', () => {
    it('returns false for identical clocks', () => {
      const clock = { a: 1, b: 2 };
      expect(happenedBefore(clock, clock)).toBe(false);
    });

    it('returns true when a happened strictly before b', () => {
      const a = { agent1: 1, agent2: 2 };
      const b = { agent1: 2, agent2: 3 };
      expect(happenedBefore(a, b)).toBe(true);
    });

    it('returns false when a has any larger value', () => {
      const a = { agent1: 3, agent2: 2 };
      const b = { agent1: 2, agent2: 3 };
      expect(happenedBefore(a, b)).toBe(false);
    });

    it('handles missing entries (treats as 0)', () => {
      const a = { agent1: 1 };
      const b = { agent1: 2, agent2: 1 };
      // a: {agent1: 1, agent2: 0} vs b: {agent1: 2, agent2: 1}
      // 1 < 2 and 0 < 1, so a happened before b
      expect(happenedBefore(a, b)).toBe(true);
    });
  });

  describe('areConcurrent', () => {
    it('returns false for identical clocks', () => {
      const clock = { a: 1, b: 2 };
      expect(areConcurrent(clock, clock)).toBe(false);
    });

    it('returns true for concurrent clocks', () => {
      const a = { agent1: 3, agent2: 2 };
      const b = { agent1: 2, agent2: 3 };
      expect(areConcurrent(a, b)).toBe(true);
    });

    it('returns false when one happened before other', () => {
      const a = { agent1: 1, agent2: 2 };
      const b = { agent1: 2, agent2: 3 };
      expect(areConcurrent(a, b)).toBe(false);
    });
  });

  describe('compare', () => {
    it('returns equal for identical clocks', () => {
      const clock = { a: 1, b: 2 };
      expect(compare(clock, { ...clock })).toBe('equal');
    });

    it('returns before when a < b', () => {
      const a = { agent1: 1 };
      const b = { agent1: 2 };
      expect(compare(a, b)).toBe('before');
    });

    it('returns after when a > b', () => {
      const a = { agent1: 2 };
      const b = { agent1: 1 };
      expect(compare(a, b)).toBe('after');
    });

    it('returns concurrent for concurrent clocks', () => {
      const a = { agent1: 2, agent2: 1 };
      const b = { agent1: 1, agent2: 2 };
      expect(compare(a, b)).toBe('concurrent');
    });
  });

  describe('totalTicks', () => {
    it('returns 0 for empty clock', () => {
      expect(totalTicks({})).toBe(0);
    });

    it('sums all tick values', () => {
      expect(totalTicks({ a: 3, b: 5, c: 2 })).toBe(10);
    });
  });

  describe('serialize/deserialize', () => {
    it('round-trips a clock', () => {
      const clock = { ui: 10, human: 5, subagent: 3 };
      const json = serialize(clock);
      const restored = deserialize(json);
      expect(restored).toEqual(clock);
    });

    it('deserializes null to empty clock', () => {
      expect(deserialize(null)).toEqual({});
    });

    it('deserializes undefined to empty clock', () => {
      expect(deserialize(undefined)).toEqual({});
    });

    it('deserializes empty string to empty clock', () => {
      expect(deserialize('')).toEqual({});
    });

    it('deserializes invalid JSON to empty clock', () => {
      expect(deserialize('not json')).toEqual({});
    });

    it('filters out non-numeric values', () => {
      const json = JSON.stringify({ valid: 5, invalid: 'string', negative: -1 });
      // negative values are >= 0 check, so -1 would be filtered
      // Actually -1 is not >= 0, so it gets filtered
      expect(deserialize(json)).toEqual({ valid: 5 });
    });
  });

  describe('clone', () => {
    it('creates a shallow copy', () => {
      const original = { a: 1, b: 2 };
      const cloned = clone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });
  });

  describe('isEmpty', () => {
    it('returns true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('returns true for all-zero values', () => {
      expect(isEmpty({ a: 0, b: 0 })).toBe(true);
    });

    it('returns false for non-zero values', () => {
      expect(isEmpty({ a: 1 })).toBe(false);
    });
  });

  describe('getAgentIds', () => {
    it('returns empty array for empty clock', () => {
      expect(getAgentIds({})).toEqual([]);
    });

    it('returns agent IDs with non-zero ticks', () => {
      const clock = { a: 1, b: 0, c: 3 };
      expect(getAgentIds(clock).sort()).toEqual(['a', 'c']);
    });
  });

  describe('constants', () => {
    it('has MAIN_AGENT_ID defined', () => {
      expect(MAIN_AGENT_ID).toBe('ui');
    });

    it('has HUMAN_AGENT_ID defined', () => {
      expect(HUMAN_AGENT_ID).toBe('human');
    });
  });

  describe('D-T-D scenarios', () => {
    it('models a simple conversation flow', () => {
      // Turn 1: Human asks, UI responds
      let clock = createClock();
      clock = tick(clock, HUMAN_AGENT_ID); // Human message
      clock = tick(clock, MAIN_AGENT_ID);  // UI processes

      expect(clock).toEqual({ human: 1, ui: 1 });

      // Turn 2: Human asks again, UI responds
      clock = tick(clock, HUMAN_AGENT_ID);
      clock = tick(clock, MAIN_AGENT_ID);

      expect(clock).toEqual({ human: 2, ui: 2 });
    });

    it('models sub-agent spawn and debrief', () => {
      // Main agent at turn 5
      let mainClock: VectorClock = { human: 5, ui: 5 };

      // Sub-agent spawned, inherits parent clock
      let subClock = merge(mainClock, { subagent1: 0 });
      expect(subClock).toEqual({ human: 5, ui: 5, subagent1: 0 });

      // Sub-agent does 3 turns
      subClock = tick(subClock, 'subagent1');
      subClock = tick(subClock, 'subagent1');
      subClock = tick(subClock, 'subagent1');
      expect(subClock).toEqual({ human: 5, ui: 5, subagent1: 3 });

      // Meanwhile, main continues
      mainClock = tick(mainClock, HUMAN_AGENT_ID);
      mainClock = tick(mainClock, MAIN_AGENT_ID);
      expect(mainClock).toEqual({ human: 6, ui: 6 });

      // Debrief: main merges sub-agent clock
      mainClock = merge(mainClock, subClock);
      expect(mainClock).toEqual({ human: 6, ui: 6, subagent1: 3 });
    });

    it('calculates hop count for decay', () => {
      // Edge created at turn 5
      const edgeClock = { ui: 5, human: 5 };

      // Reference clock at turn 10
      const refClock = { ui: 10, human: 10 };

      // Hop count = (10-5) + (10-5) = 10 hops
      expect(hopCount(edgeClock, refClock)).toBe(10);

      // With decay factor 0.85, weight = 0.85^10 ≈ 0.197
      const weight = Math.pow(0.85, hopCount(edgeClock, refClock));
      expect(weight).toBeCloseTo(0.197, 2);
    });
  });
});
