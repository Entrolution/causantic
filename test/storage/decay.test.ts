/**
 * Tests for decay weight calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHopDecayWeight,
  calculateDirectionalDecayWeight,
  calculateVectorDecayWeight,
  applyLinkBoost,
  calculateDecayWeight,
  getDeathTime,
  BACKWARD_HOP_DECAY,
  FORWARD_HOP_DECAY,
  DEFAULT_VECTOR_DECAY,
  type HopDecayConfig,
} from '../../src/storage/decay.js';
import type { DecayModelConfig } from '../../src/core/decay-types.js';

describe('decay', () => {
  describe('calculateHopDecayWeight', () => {
    describe('linear decay', () => {
      const config: HopDecayConfig = {
        type: 'linear',
        decayPerHop: 0.1,
        minWeight: 0.01,
      };

      it('returns 1 at hop 0', () => {
        expect(calculateHopDecayWeight(0, config)).toBe(1);
      });

      it('returns 0.9 at hop 1', () => {
        expect(calculateHopDecayWeight(1, config)).toBeCloseTo(0.9);
      });

      it('returns 0.5 at hop 5', () => {
        expect(calculateHopDecayWeight(5, config)).toBeCloseTo(0.5);
      });

      it('returns 0 at hop 10 (below minWeight)', () => {
        expect(calculateHopDecayWeight(10, config)).toBe(0);
      });

      it('returns 0 at hop 11 (would be negative)', () => {
        expect(calculateHopDecayWeight(11, config)).toBe(0);
      });
    });

    describe('exponential decay', () => {
      const config: HopDecayConfig = {
        type: 'exponential',
        weightPerHop: 0.8,
        minWeight: 0.01,
      };

      it('returns 1 at hop 0', () => {
        expect(calculateHopDecayWeight(0, config)).toBe(1);
      });

      it('returns 0.8 at hop 1', () => {
        expect(calculateHopDecayWeight(1, config)).toBeCloseTo(0.8);
      });

      it('returns 0.64 at hop 2', () => {
        expect(calculateHopDecayWeight(2, config)).toBeCloseTo(0.64);
      });

      it('returns ~0.107 at hop 10', () => {
        expect(calculateHopDecayWeight(10, config)).toBeCloseTo(0.107, 2);
      });

      it('returns 0 below minWeight', () => {
        // 0.8^21 ≈ 0.009 < 0.01
        expect(calculateHopDecayWeight(21, config)).toBe(0);
      });
    });

    describe('delayed-linear decay', () => {
      const config: HopDecayConfig = {
        type: 'delayed-linear',
        holdHops: 5,
        decayPerHop: 0.067,
        minWeight: 0.01,
      };

      it('returns 1 at hop 0', () => {
        expect(calculateHopDecayWeight(0, config)).toBe(1);
      });

      it('returns 1 at hop 4 (still in hold period)', () => {
        expect(calculateHopDecayWeight(4, config)).toBe(1);
      });

      it('returns 1 at hop 5 (boundary)', () => {
        expect(calculateHopDecayWeight(5, config)).toBe(1);
      });

      it('returns ~0.933 at hop 6', () => {
        // 1 - (6-5)*0.067 = 0.933
        expect(calculateHopDecayWeight(6, config)).toBeCloseTo(0.933, 2);
      });

      it('returns ~0.33 at hop 15', () => {
        // 1 - (15-5)*0.067 = 0.33
        expect(calculateHopDecayWeight(15, config)).toBeCloseTo(0.33, 2);
      });

      it('returns 0 around hop 20', () => {
        // 1 - (20-5)*0.067 = 1 - 1.005 = -0.005 → 0
        expect(calculateHopDecayWeight(20, config)).toBe(0);
      });
    });
  });

  describe('calculateDirectionalDecayWeight', () => {
    it('uses backward decay config for backward direction', () => {
      const edgeClock = { ui: 5 };
      const refClock = { ui: 10 };
      // 5 hops, backward = linear, 1 - 5*0.1 = 0.5
      const weight = calculateDirectionalDecayWeight(edgeClock, refClock, 'backward');
      expect(weight).toBeCloseTo(0.5);
    });

    it('uses forward decay config for forward direction', () => {
      const edgeClock = { ui: 5 };
      const refClock = { ui: 10 };
      // 5 hops, forward = delayed-linear with holdHops=5
      // Within hold period, so weight = 1
      const weight = calculateDirectionalDecayWeight(edgeClock, refClock, 'forward');
      expect(weight).toBe(1);
    });

    it('handles multi-agent clocks', () => {
      const edgeClock = { ui: 5, human: 5 };
      const refClock = { ui: 10, human: 10 };
      // Total hops = (10-5) + (10-5) = 10
      // Backward: 1 - 10*0.1 = 0
      const weight = calculateDirectionalDecayWeight(edgeClock, refClock, 'backward');
      expect(weight).toBe(0);
    });
  });

  describe('calculateVectorDecayWeight (legacy)', () => {
    it('applies exponential decay based on hop count', () => {
      const edgeClock = { ui: 5 };
      const refClock = { ui: 10 };
      // 5 hops, 0.8^5 ≈ 0.328
      const weight = calculateVectorDecayWeight(edgeClock, refClock, DEFAULT_VECTOR_DECAY);
      expect(weight).toBeCloseTo(0.328, 2);
    });

    it('returns 0 below minWeight', () => {
      const edgeClock = { ui: 0 };
      const refClock = { ui: 100 };
      // 100 hops, weight will be extremely small
      const weight = calculateVectorDecayWeight(edgeClock, refClock, DEFAULT_VECTOR_DECAY);
      expect(weight).toBe(0);
    });
  });

  describe('applyLinkBoost', () => {
    it('returns base weight for linkCount <= 1', () => {
      expect(applyLinkBoost(0.5, 0)).toBe(0.5);
      expect(applyLinkBoost(0.5, 1)).toBe(0.5);
    });

    it('applies logarithmic boost for multiple links', () => {
      // 5 links: boost = 1 + ln(5)*0.1 ≈ 1.16
      const boosted = applyLinkBoost(0.5, 5);
      expect(boosted).toBeCloseTo(0.5 * 1.161, 2);
    });

    it('applies larger boost for 10 links', () => {
      // 10 links: boost = 1 + ln(10)*0.1 ≈ 1.23
      const boosted = applyLinkBoost(0.5, 10);
      expect(boosted).toBeCloseTo(0.5 * 1.23, 2);
    });
  });

  describe('BACKWARD_HOP_DECAY config', () => {
    it('is linear type', () => {
      expect(BACKWARD_HOP_DECAY.type).toBe('linear');
    });

    it('dies at 10 hops', () => {
      // With decayPerHop = 0.1, dies when 1 - 10*0.1 = 0
      expect(calculateHopDecayWeight(10, BACKWARD_HOP_DECAY)).toBe(0);
    });
  });

  describe('FORWARD_HOP_DECAY config', () => {
    it('is delayed-linear type', () => {
      expect(FORWARD_HOP_DECAY.type).toBe('delayed-linear');
    });

    it('has 5-hop hold period', () => {
      expect(FORWARD_HOP_DECAY.holdHops).toBe(5);
    });

    it('maintains full weight for first 5 hops', () => {
      for (let h = 0; h <= 5; h++) {
        expect(calculateHopDecayWeight(h, FORWARD_HOP_DECAY)).toBe(1);
      }
    });
  });

  describe('calculateDecayWeight (time-based)', () => {
    describe('linear decay', () => {
      const config: DecayModelConfig = {
        type: 'linear',
        initialWeight: 1.0,
        decayRate: 0.001, // per ms
      };

      it('returns initial weight at age 0', () => {
        expect(calculateDecayWeight(config, 0)).toBe(1.0);
      });

      it('returns initial weight for negative age', () => {
        expect(calculateDecayWeight(config, -100)).toBe(1.0);
      });

      it('decays linearly', () => {
        // After 500ms: 1 - 0.001*500 = 0.5
        expect(calculateDecayWeight(config, 500)).toBeCloseTo(0.5);
      });

      it('returns 0 when fully decayed', () => {
        expect(calculateDecayWeight(config, 1500)).toBe(0);
      });
    });

    describe('delayed-linear decay', () => {
      const config: DecayModelConfig = {
        type: 'delayed-linear',
        initialWeight: 1.0,
        holdPeriodMs: 1000,
        decayRate: 0.001,
      };

      it('holds at initial weight during hold period', () => {
        expect(calculateDecayWeight(config, 500)).toBe(1.0);
        expect(calculateDecayWeight(config, 999)).toBe(1.0);
      });

      it('starts decaying after hold period', () => {
        // At 1500ms: 1 - 0.001*(1500-1000) = 0.5
        expect(calculateDecayWeight(config, 1500)).toBeCloseTo(0.5);
      });
    });

    describe('exponential decay', () => {
      const config: DecayModelConfig = {
        type: 'exponential',
        initialWeight: 1.0,
        decayRate: 0.001,
      };

      it('returns initial weight at age 0', () => {
        expect(calculateDecayWeight(config, 0)).toBe(1.0);
      });

      it('decays exponentially', () => {
        // e^(-0.001*1000) ≈ 0.368
        expect(calculateDecayWeight(config, 1000)).toBeCloseTo(0.368, 2);
      });
    });

    describe('power-law decay', () => {
      const config: DecayModelConfig = {
        type: 'power-law',
        initialWeight: 1.0,
        decayRate: 0.001,
        powerExponent: 2,
      };

      it('returns initial weight at age 0', () => {
        expect(calculateDecayWeight(config, 0)).toBe(1.0);
      });

      it('decays according to power law', () => {
        // 1 / (1 + 0.001*1000)^2 = 1/4 = 0.25
        expect(calculateDecayWeight(config, 1000)).toBeCloseTo(0.25);
      });
    });
  });

  describe('getDeathTime', () => {
    it('returns death time for linear decay', () => {
      const config: DecayModelConfig = {
        type: 'linear',
        initialWeight: 1.0,
        decayRate: 0.001,
      };
      // Death at w0/rate = 1000ms
      expect(getDeathTime(config)).toBe(1000);
    });

    it('returns death time for delayed-linear decay', () => {
      const config: DecayModelConfig = {
        type: 'delayed-linear',
        initialWeight: 1.0,
        holdPeriodMs: 500,
        decayRate: 0.001,
      };
      // Death at hold + w0/rate = 500 + 1000 = 1500ms
      expect(getDeathTime(config)).toBe(1500);
    });

    it('returns null for exponential decay', () => {
      const config: DecayModelConfig = {
        type: 'exponential',
        initialWeight: 1.0,
        decayRate: 0.001,
      };
      expect(getDeathTime(config)).toBeNull();
    });

    it('returns null for power-law decay', () => {
      const config: DecayModelConfig = {
        type: 'power-law',
        initialWeight: 1.0,
        decayRate: 0.001,
      };
      expect(getDeathTime(config)).toBeNull();
    });

    it('returns null for zero decay rate', () => {
      const config: DecayModelConfig = {
        type: 'linear',
        initialWeight: 1.0,
        decayRate: 0,
      };
      expect(getDeathTime(config)).toBeNull();
    });
  });
});
