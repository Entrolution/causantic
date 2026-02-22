import { describe, it, expect } from 'vitest';
import {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  formatTime,
} from '../../src/core/decay-types.js';

describe('decay-types', () => {
  describe('time constants', () => {
    it('MS_PER_SECOND equals 1000', () => {
      expect(MS_PER_SECOND).toBe(1000);
    });

    it('MS_PER_MINUTE equals 60000', () => {
      expect(MS_PER_MINUTE).toBe(60_000);
    });

    it('MS_PER_HOUR equals 3600000', () => {
      expect(MS_PER_HOUR).toBe(3_600_000);
    });

    it('MS_PER_DAY equals 86400000', () => {
      expect(MS_PER_DAY).toBe(86_400_000);
    });

    it('MS_PER_WEEK equals 604800000', () => {
      expect(MS_PER_WEEK).toBe(604_800_000);
    });

    it('constants are consistent with each other', () => {
      expect(MS_PER_MINUTE).toBe(60 * MS_PER_SECOND);
      expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
      expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
      expect(MS_PER_WEEK).toBe(7 * MS_PER_DAY);
    });
  });

  describe('formatTime', () => {
    it('formats sub-minute values as seconds', () => {
      expect(formatTime(5000)).toBe('5s');
      expect(formatTime(30_000)).toBe('30s');
      expect(formatTime(59_999)).toBe('60s');
    });

    it('formats sub-hour values as minutes', () => {
      expect(formatTime(MS_PER_MINUTE)).toBe('1.0m');
      expect(formatTime(5 * MS_PER_MINUTE)).toBe('5.0m');
      expect(formatTime(30 * MS_PER_MINUTE)).toBe('30.0m');
    });

    it('formats sub-day values as hours', () => {
      expect(formatTime(MS_PER_HOUR)).toBe('1.0h');
      expect(formatTime(12 * MS_PER_HOUR)).toBe('12.0h');
      expect(formatTime(23.5 * MS_PER_HOUR)).toBe('23.5h');
    });

    it('formats day-or-more values as days', () => {
      expect(formatTime(MS_PER_DAY)).toBe('1.0d');
      expect(formatTime(7 * MS_PER_DAY)).toBe('7.0d');
      expect(formatTime(30 * MS_PER_DAY)).toBe('30.0d');
    });

    it('formats exactly at boundaries', () => {
      // Exactly 1 minute → should be in minutes range
      expect(formatTime(MS_PER_MINUTE)).toBe('1.0m');
      // Exactly 1 hour → should be in hours range
      expect(formatTime(MS_PER_HOUR)).toBe('1.0h');
      // Exactly 1 day → should be in days range
      expect(formatTime(MS_PER_DAY)).toBe('1.0d');
    });

    it('formats zero milliseconds', () => {
      expect(formatTime(0)).toBe('0s');
    });

    it('formats 1 millisecond', () => {
      expect(formatTime(1)).toBe('0s');
    });

    it('formats fractional minutes', () => {
      // 90 seconds = 1.5 minutes
      expect(formatTime(90_000)).toBe('1.5m');
    });

    it('formats fractional hours', () => {
      // 90 minutes = 1.5 hours
      expect(formatTime(90 * MS_PER_MINUTE)).toBe('1.5h');
    });

    it('formats fractional days', () => {
      // 36 hours = 1.5 days
      expect(formatTime(36 * MS_PER_HOUR)).toBe('1.5d');
    });
  });
});
