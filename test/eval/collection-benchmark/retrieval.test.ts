/**
 * Tests for retrieval quality benchmarks.
 *
 * Mocks assembleContext to avoid needing a real embedder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BenchmarkSample, SamplerThresholds } from '../../../src/eval/collection-benchmark/types.js';

// Mock chunk-store
vi.mock('../../../src/storage/chunk-store.js', () => ({
  getChunkById: vi.fn((id: string) => ({
    id,
    content: `Content for chunk ${id}`,
    sessionSlug: id.startsWith('proj-b') ? 'proj-b' : 'proj-a',
    sessionId: id.includes('s2') ? 's2' : 's1',
    approxTokens: 50,
  })),
}));

// Mock token counter
vi.mock('../../../src/utils/token-counter.js', () => ({
  approximateTokens: (text: string) => Math.ceil(text.length / 4),
}));

// Mock assembleContext
const mockAssembleContext = vi.fn();
vi.mock('../../../src/retrieval/context-assembler.js', () => ({
  assembleContext: (...args: unknown[]) => mockAssembleContext(...args),
}));

import { runRetrievalBenchmarks } from '../../../src/eval/collection-benchmark/retrieval.js';

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
    crossSessionPairs: [
      { chunkIdA: 'c1', chunkIdB: 'c3-s2', edgeType: 'file-path' },
    ],
    crossProjectPairs: [
      { chunkIdA: 'c1', projectA: 'proj-a', chunkIdB: 'proj-b-c1', projectB: 'proj-b' },
    ],
    thresholds: makeThresholds(),
    ...overrides,
  };
}

describe('runRetrievalBenchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should compute adjacent recall when chunks are found', async () => {
    // Mock assembleContext to return adjacent chunks in results
    mockAssembleContext.mockResolvedValue({
      chunks: [
        { id: 'c2', preview: 'chunk 2 content', sessionSlug: 'proj-a', source: 'vector' },
        { id: 'c4', preview: 'chunk 4 content', sessionSlug: 'proj-a', source: 'vector' },
        { id: 'c3', preview: 'chunk 3 content', sessionSlug: 'proj-a', source: 'graph' },
      ],
      tokenCount: 150,
    });

    const sample = makeSample();
    const { result, skipped } = await runRetrievalBenchmarks(sample, 10);

    // c2 is found for c1's query (top 5 and top 10), c3 is found for c2's query (top 10)
    expect(result.adjacentRecallAt5).toBeGreaterThan(0);
    expect(result.adjacentRecallAt10).toBeGreaterThan(0);
    expect(result.mrr).toBeGreaterThan(0);
  });

  it('should return zero recall when no adjacent chunks found', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [
        { id: 'x1', preview: 'unrelated', sessionSlug: 'proj-a', source: 'vector' },
        { id: 'x2', preview: 'unrelated', sessionSlug: 'proj-a', source: 'vector' },
      ],
      tokenCount: 100,
    });

    const sample = makeSample();
    const { result } = await runRetrievalBenchmarks(sample, 10);

    expect(result.adjacentRecallAt5).toBe(0);
    expect(result.adjacentRecallAt10).toBe(0);
    expect(result.mrr).toBe(0);
  });

  it('should skip adjacent recall when threshold not met', async () => {
    const sample = makeSample({
      thresholds: makeThresholds({
        canRunAdjacentRecall: false,
        reasons: new Map([['adjacentRecall', 'need >=2 sessions, you have 1']]),
      }),
    });

    const { skipped } = await runRetrievalBenchmarks(sample, 10);

    expect(skipped).toHaveLength(1);
    expect(skipped[0].name).toBe('Adjacent Chunk Recall');
  });

  it('should skip cross-session bridging when threshold not met', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [{ id: 'c2', preview: 'content', sessionSlug: 'proj-a', source: 'vector' }],
      tokenCount: 50,
    });

    const sample = makeSample({
      thresholds: makeThresholds({
        canRunCrossSessionBridging: false,
        reasons: new Map([['crossSessionBridging', 'need >=3 sessions']]),
      }),
    });

    const { skipped } = await runRetrievalBenchmarks(sample, 10);

    const bridgingSkip = skipped.find(s => s.name === 'Cross-Session Bridging');
    expect(bridgingSkip).toBeDefined();
  });

  it('should skip precision@K when threshold not met', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [{ id: 'c2', preview: 'content', sessionSlug: 'proj-a', source: 'vector' }],
      tokenCount: 50,
    });

    const sample = makeSample({
      thresholds: makeThresholds({
        canRunPrecisionAtK: false,
        reasons: new Map([['precisionAtK', 'need >=2 projects']]),
      }),
    });

    const { skipped } = await runRetrievalBenchmarks(sample, 10);

    const precisionSkip = skipped.find(s => s.name === 'Precision@K');
    expect(precisionSkip).toBeDefined();
  });

  it('should compute token efficiency', async () => {
    // Return chunks from the same project = relevant
    mockAssembleContext.mockResolvedValue({
      chunks: [
        { id: 'c2', preview: 'relevant chunk content here', sessionSlug: 'proj-a', source: 'vector' },
        { id: 'c3', preview: 'also relevant content', sessionSlug: 'proj-a', source: 'vector' },
      ],
      tokenCount: 200,
    });

    const sample = makeSample();
    const { result } = await runRetrievalBenchmarks(sample, 10);

    // All returned chunks are from 'proj-a' matching query chunks
    expect(result.tokenEfficiency).toBeGreaterThan(0);
    expect(result.meanUsefulTokensPerQuery).toBeGreaterThan(0);
  });

  it('should handle empty results from assembleContext', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [],
      tokenCount: 0,
    });

    const sample = makeSample();
    const { result } = await runRetrievalBenchmarks(sample, 10);

    expect(result.adjacentRecallAt5).toBe(0);
    expect(result.adjacentRecallAt10).toBe(0);
    expect(result.bridgingRecallAt10).toBe(0);
  });

  it('should call progress callback', async () => {
    mockAssembleContext.mockResolvedValue({
      chunks: [{ id: 'c2', preview: 'content', sessionSlug: 'proj-a', source: 'vector' }],
      tokenCount: 50,
    });

    const progressMessages: string[] = [];
    const sample = makeSample();
    await runRetrievalBenchmarks(sample, 10, (msg) => progressMessages.push(msg));

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some(m => m.includes('Adjacent chunk recall'))).toBe(true);
  });

  it('should compute bridging recall when cross-session pairs found', async () => {
    // First calls for adjacent recall, then bridging
    let callCount = 0;
    mockAssembleContext.mockImplementation(async () => {
      callCount++;
      // Return the cross-session target chunk in bridging queries
      return {
        chunks: [
          { id: 'c3-s2', preview: 'cross session', sessionSlug: 'proj-a', source: 'graph' },
          { id: 'c2', preview: 'adjacent', sessionSlug: 'proj-a', source: 'vector' },
        ],
        tokenCount: 100,
      };
    });

    const sample = makeSample();
    const { result } = await runRetrievalBenchmarks(sample, 10);

    expect(result.bridgingRecallAt10).toBeGreaterThan(0);
  });
});
