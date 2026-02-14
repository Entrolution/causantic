/**
 * Tests for chain quality benchmarks.
 *
 * Mocks recallContext and chunk-store to avoid needing a real embedder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  BenchmarkSample,
  SamplerThresholds,
} from '../../../src/eval/collection-benchmark/types.js';

// Mock chunk-store
vi.mock('../../../src/storage/chunk-store.js', () => ({
  getChunkById: vi.fn((id: string) => ({
    id,
    content: `Content for chunk ${id}`,
    sessionSlug: 'proj-a',
    sessionId: 's1',
    approxTokens: 50,
  })),
}));

// Mock recallContext
const mockRecallContext = vi.fn();
vi.mock('../../../src/retrieval/chain-assembler.js', () => ({
  recallContext: (...args: unknown[]) => mockRecallContext(...args),
}));

import { runChainQualityBenchmarks } from '../../../src/eval/collection-benchmark/chain-quality.js';

function makeThresholds(overrides: Partial<SamplerThresholds> = {}): SamplerThresholds {
  return {
    canRunAdjacentRecall: true,
    canRunCrossSessionBridging: true,
    canRunPrecisionAtK: true,
    reasons: new Map(),
    ...overrides,
  };
}

function makeSample(overrides: Partial<BenchmarkSample> = {}): BenchmarkSample {
  return {
    queryChunkIds: ['c1', 'c2', 'c3'],
    adjacentPairs: [
      { queryChunkId: 'c1', adjacentChunkId: 'c2', sessionId: 's1' },
      { queryChunkId: 'c2', adjacentChunkId: 'c3', sessionId: 's1' },
    ],
    crossSessionPairs: [],
    crossProjectPairs: [],
    thresholds: makeThresholds(),
    ...overrides,
  };
}

describe('runChainQualityBenchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should compute chain quality for all chain responses', async () => {
    mockRecallContext.mockResolvedValue({
      mode: 'chain',
      chainLength: 4,
      chunks: [
        { id: 'r1', weight: 0.8 },
        { id: 'r2', weight: 0.7 },
        { id: 'r3', weight: 0.6 },
        { id: 'r4', weight: 0.5 },
      ],
      tokenCount: 200,
    });

    const sample = makeSample();
    const { result } = await runChainQualityBenchmarks(sample);

    expect(result.meanChainLength).toBe(4);
    expect(result.chainCoverage).toBe(1); // All queries returned chains
    expect(result.fallbackRate).toBe(0);
    expect(result.meanScorePerToken).toBeGreaterThan(0);
    // (0.8+0.7+0.6+0.5)/200 = 2.6/200 = 0.013
    expect(result.meanScorePerToken).toBeCloseTo(0.013, 3);
  });

  it('should compute correct fallback rate', async () => {
    let callCount = 0;
    mockRecallContext.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return {
          mode: 'chain',
          chainLength: 3,
          chunks: [
            { id: 'r1', weight: 0.8 },
            { id: 'r2', weight: 0.7 },
            { id: 'r3', weight: 0.6 },
          ],
          tokenCount: 150,
        };
      }
      return {
        mode: 'search',
        chainLength: 0,
        chunks: [{ id: 'r1', weight: 0.8 }],
        tokenCount: 50,
      };
    });

    const sample = makeSample();
    const { result } = await runChainQualityBenchmarks(sample);

    expect(result.chainCoverage).toBeCloseTo(2 / 3);
    expect(result.fallbackRate).toBeCloseTo(1 / 3);
    expect(result.meanChainLength).toBe(3); // Only chain responses counted
  });

  it('should handle all fallback responses', async () => {
    mockRecallContext.mockResolvedValue({
      mode: 'search',
      chainLength: 0,
      chunks: [{ id: 'r1', weight: 0.8 }],
      tokenCount: 50,
    });

    const sample = makeSample();
    const { result } = await runChainQualityBenchmarks(sample);

    expect(result.meanChainLength).toBe(0);
    expect(result.meanScorePerToken).toBe(0);
    expect(result.chainCoverage).toBe(0);
    expect(result.fallbackRate).toBe(1);
  });

  it('should call progress callback', async () => {
    mockRecallContext.mockResolvedValue({
      mode: 'chain',
      chainLength: 2,
      chunks: [
        { id: 'r1', weight: 0.8 },
        { id: 'r2', weight: 0.7 },
      ],
      tokenCount: 100,
    });

    const progressMessages: string[] = [];
    const sample = makeSample();
    await runChainQualityBenchmarks(sample, (msg) => progressMessages.push(msg));

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some((m) => m.includes('Chain quality analysis'))).toBe(true);
  });

  it('should limit queries to 30 max', async () => {
    mockRecallContext.mockResolvedValue({
      mode: 'chain',
      chainLength: 2,
      chunks: [
        { id: 'r1', weight: 0.8 },
        { id: 'r2', weight: 0.7 },
      ],
      tokenCount: 100,
    });

    const manyIds = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const sample = makeSample({ queryChunkIds: manyIds });
    await runChainQualityBenchmarks(sample);

    expect(mockRecallContext).toHaveBeenCalledTimes(30);
  });

  it('should handle zero token count gracefully', async () => {
    mockRecallContext.mockResolvedValue({
      mode: 'chain',
      chainLength: 2,
      chunks: [
        { id: 'r1', weight: 0.8 },
        { id: 'r2', weight: 0.7 },
      ],
      tokenCount: 0,
    });

    const sample = makeSample();
    const { result } = await runChainQualityBenchmarks(sample);

    // Should not produce NaN or infinity from division by zero
    expect(result.meanScorePerToken).toBe(0);
    expect(result.meanChainLength).toBe(2);
  });

  it('should skip chunks that are not found', async () => {
    const { getChunkById } = await import('../../../src/storage/chunk-store.js');
    (getChunkById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === 'c2') return null; // c2 not found
      return { id, content: `Content for chunk ${id}`, sessionSlug: 'proj-a' };
    });

    mockRecallContext.mockResolvedValue({
      mode: 'chain',
      chainLength: 2,
      chunks: [
        { id: 'r1', weight: 0.8 },
        { id: 'r2', weight: 0.7 },
      ],
      tokenCount: 100,
    });

    const sample = makeSample();
    const { result } = await runChainQualityBenchmarks(sample);

    // Only 2 out of 3 queries processed (c2 skipped)
    expect(mockRecallContext).toHaveBeenCalledTimes(2);
    expect(result.chainCoverage).toBe(1); // Both processed queries returned chains
  });
});
