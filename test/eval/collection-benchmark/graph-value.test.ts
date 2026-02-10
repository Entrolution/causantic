/**
 * Tests for graph value benchmarks.
 *
 * Mocks assembleContext and edge-store to avoid needing a real embedder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BenchmarkSample, SamplerThresholds } from '../../../src/eval/collection-benchmark/types.js';

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

// Mock edge-store
vi.mock('../../../src/storage/edge-store.js', () => ({
  getOutgoingEdges: vi.fn(() => [
    { id: 'e1', sourceChunkId: 'c1', targetChunkId: 'c2', edgeType: 'backward', referenceType: 'file-path' },
  ]),
  getIncomingEdges: vi.fn(() => []),
}));

// Mock assembleContext
const mockAssembleContext = vi.fn();
vi.mock('../../../src/retrieval/context-assembler.js', () => ({
  assembleContext: (...args: unknown[]) => mockAssembleContext(...args),
}));

import { runGraphValueBenchmarks } from '../../../src/eval/collection-benchmark/graph-value.js';

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

describe('runGraphValueBenchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should compute source attribution', async () => {
    // Full pipeline: returns mixed sources
    // Vector-only: returns fewer results
    let callIndex = 0;
    mockAssembleContext.mockImplementation(async (req: Record<string, unknown>) => {
      callIndex++;
      if (req.skipGraph) {
        // Vector-only response
        return {
          chunks: [
            { id: `v${callIndex}`, preview: 'vector result', sessionSlug: 'proj-a', source: 'vector' },
          ],
          tokenCount: 50,
        };
      }
      // Full pipeline response
      return {
        chunks: [
          { id: `r1-${callIndex}`, preview: 'vector result', sessionSlug: 'proj-a', source: 'vector' },
          { id: `r2-${callIndex}`, preview: 'graph result', sessionSlug: 'proj-a', source: 'graph' },
          { id: `r3-${callIndex}`, preview: 'cluster result', sessionSlug: 'proj-a', source: 'cluster' },
        ],
        tokenCount: 150,
      };
    });

    const sample = makeSample();
    const { result } = await runGraphValueBenchmarks(sample, 10);

    expect(result.sourceAttribution.vectorPercentage).toBeGreaterThan(0);
    expect(result.sourceAttribution.graphPercentage).toBeGreaterThan(0);
    expect(result.sourceAttribution.clusterPercentage).toBeGreaterThan(0);
    // 3 results per query (full) vs 1 per query (vector-only)
    expect(result.sourceAttribution.augmentationRatio).toBeGreaterThan(1);
  });

  it('should compute recall lift over vector-only', async () => {
    mockAssembleContext.mockImplementation(async (req: Record<string, unknown>) => {
      if (req.skipGraph) {
        // Vector-only: misses some adjacent chunks
        return {
          chunks: [
            { id: 'x1', preview: 'irrelevant', sessionSlug: 'proj-a', source: 'vector' },
          ],
          tokenCount: 50,
        };
      }
      // Full pipeline: finds adjacent chunks
      return {
        chunks: [
          { id: 'c2', preview: 'adjacent', sessionSlug: 'proj-a', source: 'graph' },
          { id: 'c3', preview: 'adjacent', sessionSlug: 'proj-a', source: 'graph' },
        ],
        tokenCount: 100,
      };
    });

    const sample = makeSample();
    const { result } = await runGraphValueBenchmarks(sample, 10);

    // Full pipeline finds adjacents, vector-only doesn't
    expect(result.fullRecallAt10).toBeGreaterThan(result.vectorOnlyRecallAt10);
    expect(result.uniqueGraphFinds).toBeGreaterThan(0);
    expect(result.lift).toBeGreaterThan(0);
  });

  it('should handle no adjacent pairs for comparison', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [
        { id: 'r1', preview: 'result', sessionSlug: 'proj-a', source: 'vector' },
      ],
      tokenCount: 50,
    });

    const sample = makeSample({ adjacentPairs: [] });
    const { result } = await runGraphValueBenchmarks(sample, 10);

    expect(result.fullRecallAt10).toBe(0);
    expect(result.vectorOnlyRecallAt10).toBe(0);
    expect(result.lift).toBe(0);
  });

  it('should compute edge type effectiveness for graph-sourced results', async () => {
    mockAssembleContext.mockImplementation(async (req: Record<string, unknown>) => {
      if (req.skipGraph) {
        return { chunks: [], tokenCount: 0 };
      }
      return {
        chunks: [
          { id: 'c2', preview: 'graph result', sessionSlug: 'proj-a', source: 'graph' },
        ],
        tokenCount: 50,
      };
    });

    const sample = makeSample();
    const { result } = await runGraphValueBenchmarks(sample, 10);

    // getOutgoingEdges mock returns 'file-path' edge
    expect(result.edgeTypeEffectiveness.length).toBeGreaterThan(0);
    const filePathEff = result.edgeTypeEffectiveness.find(e => e.type === 'file-path');
    expect(filePathEff).toBeDefined();
    expect(filePathEff!.chunksSurfaced).toBeGreaterThan(0);
  });

  it('should handle empty query results', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [],
      tokenCount: 0,
    });

    const sample = makeSample();
    const { result } = await runGraphValueBenchmarks(sample, 10);

    expect(result.sourceAttribution.vectorPercentage).toBe(0);
    expect(result.sourceAttribution.graphPercentage).toBe(0);
    expect(result.sourceAttribution.augmentationRatio).toBe(1);
  });

  it('should call progress callback', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [
        { id: 'r1', preview: 'result', sessionSlug: 'proj-a', source: 'vector' },
      ],
      tokenCount: 50,
    });

    const progressMessages: string[] = [];
    const sample = makeSample();
    await runGraphValueBenchmarks(sample, 10, (msg) => progressMessages.push(msg));

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some(m => m.includes('Graph value analysis'))).toBe(true);
  });

  it('should limit queries to 30 max', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [{ id: 'r1', preview: 'result', sessionSlug: 'proj-a', source: 'vector' }],
      tokenCount: 50,
    });

    const manyIds = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const sample = makeSample({ queryChunkIds: manyIds });
    await runGraphValueBenchmarks(sample, 10);

    // Each query produces 2 assembleContext calls (full + vector-only)
    // Max 30 queries * 2 = 60 calls
    expect(mockAssembleContext).toHaveBeenCalledTimes(60);
  });
});
