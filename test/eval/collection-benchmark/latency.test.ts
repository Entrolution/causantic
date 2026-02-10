/**
 * Tests for latency percentile calculations.
 */

import { describe, it, expect } from 'vitest';
import { computePercentiles } from '../../../src/eval/collection-benchmark/latency.js';

describe('computePercentiles', () => {
  it('should return zeros for empty array', () => {
    const result = computePercentiles([]);
    expect(result.p50).toBe(0);
    expect(result.p95).toBe(0);
    expect(result.p99).toBe(0);
  });

  it('should compute percentiles for single value', () => {
    const result = computePercentiles([100]);
    expect(result.p50).toBe(100);
    expect(result.p95).toBe(100);
    expect(result.p99).toBe(100);
  });

  it('should compute percentiles for sorted values', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computePercentiles(values);

    expect(result.p50).toBe(51); // 50th percentile of 1-100
    expect(result.p95).toBe(96);
    expect(result.p99).toBe(100);
  });

  it('should compute percentiles for unsorted values', () => {
    const values = [50, 10, 90, 30, 70, 20, 80, 40, 60, 100];
    const result = computePercentiles(values);

    // After sorting: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(result.p50).toBe(60);
    expect(result.p95).toBe(100);
    expect(result.p99).toBe(100);
  });

  it('should handle identical values', () => {
    const values = Array.from({ length: 20 }, () => 42);
    const result = computePercentiles(values);

    expect(result.p50).toBe(42);
    expect(result.p95).toBe(42);
    expect(result.p99).toBe(42);
  });

  it('should warm-up exclusion be handled by caller', () => {
    // Verify that computePercentiles does not do warm-up exclusion
    // (that's the caller's responsibility)
    const withWarmup = [1000, 1000, 1000, 10, 20, 30, 40, 50];
    const result = computePercentiles(withWarmup);

    // p50 should be affected by the warm-up values if they're included
    expect(result.p50).toBeGreaterThan(30);
  });
});
