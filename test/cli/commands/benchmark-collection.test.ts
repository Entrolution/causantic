/**
 * Tests for the benchmark-collection CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/storage/db.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../../src/eval/collection-benchmark/runner.js', () => ({
  runCollectionBenchmark: vi.fn(),
}));

vi.mock('../../../src/eval/collection-benchmark/history.js', () => ({
  getBenchmarkHistory: vi.fn(),
}));

vi.mock('../../../src/eval/collection-benchmark/reporter.js', () => ({
  writeReports: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { benchmarkCollectionCommand } from '../../../src/cli/commands/benchmark-collection.js';
import { runCollectionBenchmark } from '../../../src/eval/collection-benchmark/runner.js';
import { getBenchmarkHistory } from '../../../src/eval/collection-benchmark/history.js';
import { writeReports } from '../../../src/eval/collection-benchmark/reporter.js';

const mockRunBenchmark = vi.mocked(runCollectionBenchmark);
const mockGetHistory = vi.mocked(getBenchmarkHistory);
const mockWriteReports = vi.mocked(writeReports);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const mockBenchmarkResult = {
  overallScore: 85,
  highlights: ['Good retrieval quality', 'Fast latency'],
  profile: 'standard' as const,
  categories: {},
  timestamp: new Date().toISOString(),
  collectionStats: {},
};

describe('benchmarkCollectionCommand', () => {
  it('has correct name and description', () => {
    expect(benchmarkCollectionCommand.name).toBe('benchmark-collection');
    expect(benchmarkCollectionCommand.description).toContain('Benchmark');
  });

  it('prints usage on --help', async () => {
    await benchmarkCollectionCommand.handler(['--help']);

    expect(console.log).toHaveBeenCalledWith(benchmarkCollectionCommand.usage);
    expect(mockRunBenchmark).not.toHaveBeenCalled();
  });

  it('prints usage on -h', async () => {
    await benchmarkCollectionCommand.handler(['-h']);

    expect(console.log).toHaveBeenCalledWith(benchmarkCollectionCommand.usage);
  });

  it('shows history when --history flag is passed', async () => {
    mockGetHistory.mockReturnValue([
      { id: 1, timestamp: '2024-01-15T00:00:00Z', profile: 'standard', overallScore: 85 },
      { id: 2, timestamp: '2024-01-16T00:00:00Z', profile: 'full', overallScore: 90 },
    ] as any);

    await benchmarkCollectionCommand.handler(['--history']);

    expect(mockGetHistory).toHaveBeenCalledWith(20);
    expect(console.log).toHaveBeenCalledWith('Benchmark History:');
    expect(mockRunBenchmark).not.toHaveBeenCalled();
  });

  it('prints message when no history exists', async () => {
    mockGetHistory.mockReturnValue([]);

    await benchmarkCollectionCommand.handler(['--history']);

    expect(console.log).toHaveBeenCalledWith('No benchmark history found. Run a benchmark first.');
  });

  it('runs standard benchmark by default', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler([]);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'standard',
        sampleSize: 50,
        includeTuning: true,
      }),
    );
  });

  it('passes --quick profile', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--quick']);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'quick' }),
    );
  });

  it('passes --full profile', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--full']);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'full' }),
    );
  });

  it('passes custom sample size and seed', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--sample-size', '100', '--seed', '42']);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ sampleSize: 100, seed: 42 }),
    );
  });

  it('passes --no-tuning flag', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--no-tuning']);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ includeTuning: false }),
    );
  });

  it('passes project filter', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--project', 'my-project']);

    expect(mockRunBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ projectFilter: 'my-project' }),
    );
  });

  it('prints highlights from results', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler([]);

    expect(console.log).toHaveBeenCalledWith('  - Good retrieval quality');
    expect(console.log).toHaveBeenCalledWith('  - Fast latency');
  });

  it('writes reports by default', async () => {
    mockRunBenchmark.mockResolvedValue(mockBenchmarkResult as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler([]);

    expect(mockWriteReports).toHaveBeenCalledWith(mockBenchmarkResult, './causantic-benchmark');
  });

  it('writes JSON only with --json flag', async () => {
    mockRunBenchmark.mockResolvedValue({ ...mockBenchmarkResult, highlights: [] } as any);

    await benchmarkCollectionCommand.handler(['--json', '--output', '/tmp/test-out']);

    expect(mockWriteReports).not.toHaveBeenCalled();
  });

  it('suggests --full when running with non-full profile', async () => {
    mockRunBenchmark.mockResolvedValue({ ...mockBenchmarkResult, highlights: [] } as any);
    mockWriteReports.mockResolvedValue({ markdownPath: '/out/report.md', jsonPath: '/out/report.json' });

    await benchmarkCollectionCommand.handler(['--quick']);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('--full'),
    );
  });
});
