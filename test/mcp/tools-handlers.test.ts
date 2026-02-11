/**
 * Tests for MCP tool handler execution.
 *
 * Unlike tools.test.ts (which validates schema structure), this file tests
 * the actual handler behavior: argument passing, mock interactions, return values,
 * and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/retrieval/context-assembler.js', () => ({
  recall: vi.fn(),
  explain: vi.fn(),
  predict: vi.fn(),
}));

vi.mock('../../src/storage/chunk-store.js', () => ({
  getDistinctProjects: vi.fn(),
  getSessionsForProject: vi.fn(),
}));

vi.mock('../../src/retrieval/session-reconstructor.js', () => ({
  reconstructSession: vi.fn(),
  formatReconstruction: vi.fn(),
}));

vi.mock('../../src/config/memory-config.js', () => ({
  getConfig: vi.fn(() => ({ mcpMaxResponseTokens: 2000 })),
}));

import {
  recallTool,
  explainTool,
  predictTool,
  listProjectsTool,
  listSessionsTool,
  reconstructTool,
} from '../../src/mcp/tools.js';

import { recall, explain, predict } from '../../src/retrieval/context-assembler.js';
import { getDistinctProjects, getSessionsForProject } from '../../src/storage/chunk-store.js';
import { reconstructSession, formatReconstruction } from '../../src/retrieval/session-reconstructor.js';

const mockRecall = vi.mocked(recall);
const mockExplain = vi.mocked(explain);
const mockPredict = vi.mocked(predict);
const mockGetDistinctProjects = vi.mocked(getDistinctProjects);
const mockGetSessionsForProject = vi.mocked(getSessionsForProject);
const mockReconstructSession = vi.mocked(reconstructSession);
const mockFormatReconstruction = vi.mocked(formatReconstruction);

/** Helper to build a minimal RetrievalResponse. */
function makeResponse(
  chunks: Array<{ id: string; sessionSlug: string; weight: number; preview: string; source?: 'vector' | 'keyword' | 'cluster' | 'graph' }>,
  text: string,
  tokenCount: number,
) {
  return { chunks, text, tokenCount, totalConsidered: chunks.length, elapsedMs: 10 };
}

const emptyResponse = makeResponse([], '', 0);

const sampleChunks = [
  { id: 'c1', sessionSlug: 'proj', weight: 0.9, preview: 'chunk 1 preview', source: 'vector' as const },
  { id: 'c2', sessionSlug: 'proj', weight: 0.7, preview: 'chunk 2 preview', source: 'keyword' as const },
];

const sampleResponse = makeResponse(sampleChunks, 'Assembled context text', 350);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// recallTool.handler
// ---------------------------------------------------------------------------
describe('recallTool.handler', () => {
  it('calls recall with correct params and default range "short"', async () => {
    mockRecall.mockResolvedValue(sampleResponse);

    await recallTool.handler({ query: 'authentication flow' });

    expect(mockRecall).toHaveBeenCalledOnce();
    expect(mockRecall).toHaveBeenCalledWith('authentication flow', {
      maxTokens: 2000,
      range: 'short',
      projectFilter: undefined,
    });
  });

  it('passes explicit range and project filter', async () => {
    mockRecall.mockResolvedValue(sampleResponse);

    await recallTool.handler({ query: 'schema migration', range: 'long', project: 'my-proj' });

    expect(mockRecall).toHaveBeenCalledWith('schema migration', {
      maxTokens: 2000,
      range: 'long',
      projectFilter: 'my-proj',
    });
  });

  it('returns formatted text with chunk count for non-empty results', async () => {
    mockRecall.mockResolvedValue(sampleResponse);

    const result = await recallTool.handler({ query: 'anything' });

    expect(result).toContain('Found 2 relevant memory chunks');
    expect(result).toContain('350 tokens');
    expect(result).toContain('Assembled context text');
  });

  it('returns "No relevant memory found." for empty results', async () => {
    mockRecall.mockResolvedValue(emptyResponse);

    const result = await recallTool.handler({ query: 'unknown topic' });

    expect(result).toBe('No relevant memory found.');
  });
});

// ---------------------------------------------------------------------------
// explainTool.handler
// ---------------------------------------------------------------------------
describe('explainTool.handler', () => {
  it('calls explain with default range "long"', async () => {
    mockExplain.mockResolvedValue(sampleResponse);

    await explainTool.handler({ topic: 'why we chose React' });

    expect(mockExplain).toHaveBeenCalledOnce();
    expect(mockExplain).toHaveBeenCalledWith('why we chose React', {
      maxTokens: 2000,
      range: 'long',
      projectFilter: undefined,
    });
  });

  it('passes explicit range "short" when provided', async () => {
    mockExplain.mockResolvedValue(sampleResponse);

    await explainTool.handler({ topic: 'database setup', range: 'short' });

    expect(mockExplain).toHaveBeenCalledWith('database setup', {
      maxTokens: 2000,
      range: 'short',
      projectFilter: undefined,
    });
  });

  it('passes project filter', async () => {
    mockExplain.mockResolvedValue(sampleResponse);

    await explainTool.handler({ topic: 'auth', project: 'backend' });

    expect(mockExplain).toHaveBeenCalledWith('auth', {
      maxTokens: 2000,
      range: 'long',
      projectFilter: 'backend',
    });
  });

  it('returns formatted text for non-empty results', async () => {
    mockExplain.mockResolvedValue(sampleResponse);

    const result = await explainTool.handler({ topic: 'auth' });

    expect(result).toContain('Found 2 relevant memory chunks');
    expect(result).toContain('Assembled context text');
  });

  it('returns "No relevant memory found." for empty results', async () => {
    mockExplain.mockResolvedValue(emptyResponse);

    const result = await explainTool.handler({ topic: 'nothing here' });

    expect(result).toBe('No relevant memory found.');
  });
});

// ---------------------------------------------------------------------------
// predictTool.handler
// ---------------------------------------------------------------------------
describe('predictTool.handler', () => {
  it('calls predict with half the token budget', async () => {
    mockPredict.mockResolvedValue(sampleResponse);

    await predictTool.handler({ context: 'working on migrations' });

    expect(mockPredict).toHaveBeenCalledOnce();
    expect(mockPredict).toHaveBeenCalledWith('working on migrations', {
      maxTokens: 1000, // 2000 / 2
      projectFilter: undefined,
    });
  });

  it('passes project filter', async () => {
    mockPredict.mockResolvedValue(sampleResponse);

    await predictTool.handler({ context: 'refactoring', project: 'core-lib' });

    expect(mockPredict).toHaveBeenCalledWith('refactoring', {
      maxTokens: 1000,
      projectFilter: 'core-lib',
    });
  });

  it('returns "No predictions available..." for empty results', async () => {
    mockPredict.mockResolvedValue(emptyResponse);

    const result = await predictTool.handler({ context: 'blank slate' });

    expect(result).toBe('No predictions available based on current context.');
  });

  it('returns "Potentially relevant context..." header for non-empty results', async () => {
    mockPredict.mockResolvedValue(sampleResponse);

    const result = await predictTool.handler({ context: 'setting up CI' });

    expect(result).toContain('Potentially relevant context (2 items)');
    expect(result).toContain('Assembled context text');
  });
});

// ---------------------------------------------------------------------------
// listProjectsTool.handler
// ---------------------------------------------------------------------------
describe('listProjectsTool.handler', () => {
  it('returns "No projects found" for empty list', async () => {
    mockGetDistinctProjects.mockReturnValue([]);

    const result = await listProjectsTool.handler({});

    expect(result).toBe('No projects found in memory.');
  });

  it('returns formatted project list', async () => {
    mockGetDistinctProjects.mockReturnValue([
      { slug: 'test-project', chunkCount: 10, firstSeen: '2025-01-01T00:00:00Z', lastSeen: '2025-02-01T00:00:00Z' },
    ]);

    const result = await listProjectsTool.handler({});

    expect(result).toContain('Projects in memory:');
    expect(result).toContain('test-project');
    expect(result).toContain('10 chunks');
  });

  it('lists multiple projects', async () => {
    mockGetDistinctProjects.mockReturnValue([
      { slug: 'alpha', chunkCount: 5, firstSeen: '2025-01-01T00:00:00Z', lastSeen: '2025-01-15T00:00:00Z' },
      { slug: 'beta', chunkCount: 20, firstSeen: '2025-02-01T00:00:00Z', lastSeen: '2025-03-01T00:00:00Z' },
    ]);

    const result = await listProjectsTool.handler({});

    expect(result).toContain('alpha');
    expect(result).toContain('5 chunks');
    expect(result).toContain('beta');
    expect(result).toContain('20 chunks');
  });

  it('shows single date when first and last month are the same', async () => {
    mockGetDistinctProjects.mockReturnValue([
      { slug: 'single-month', chunkCount: 3, firstSeen: '2025-06-01T00:00:00Z', lastSeen: '2025-06-28T00:00:00Z' },
    ]);

    const result = await listProjectsTool.handler({});

    // When first === last the range should be displayed once, not with a separator
    // The exact formatted month depends on locale, but there should be no dash/en-dash
    // between two identical months
    const lines = result.split('\n').filter((l: string) => l.startsWith('- '));
    expect(lines.length).toBe(1);
    // Should NOT contain an en-dash between identical dates
    const dateSegment = lines[0].match(/\(.*\)/)?.[0] ?? '';
    // Split by the separator and ensure both sides (if any) are the same
    expect(dateSegment).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// listSessionsTool.handler
// ---------------------------------------------------------------------------
describe('listSessionsTool.handler', () => {
  const sampleSessions = [
    {
      sessionId: 'abc12345-full-id',
      chunkCount: 5,
      totalTokens: 1200,
      firstChunkTime: '2025-01-15T14:30:00Z',
      lastChunkTime: '2025-01-15T16:00:00Z',
    },
  ];

  it('returns sessions list with formatted output', async () => {
    mockGetSessionsForProject.mockReturnValue(sampleSessions);

    const result = await listSessionsTool.handler({ project: 'my-app' });

    expect(result).toContain('Sessions for "my-app"');
    expect(result).toContain('1 total');
    expect(result).toContain('abc12345'); // first 8 chars
    expect(result).toContain('5 chunks');
    expect(result).toContain('1200 tokens');
  });

  it('passes from/to directly when provided', async () => {
    mockGetSessionsForProject.mockReturnValue(sampleSessions);

    await listSessionsTool.handler({
      project: 'my-app',
      from: '2025-01-01T00:00:00Z',
      to: '2025-02-01T00:00:00Z',
    });

    expect(mockGetSessionsForProject).toHaveBeenCalledWith(
      'my-app',
      '2025-01-01T00:00:00Z',
      '2025-02-01T00:00:00Z',
    );
  });

  it('converts days_back to from/to', async () => {
    mockGetSessionsForProject.mockReturnValue(sampleSessions);

    const before = Date.now();
    await listSessionsTool.handler({ project: 'my-app', days_back: 7 });
    const after = Date.now();

    expect(mockGetSessionsForProject).toHaveBeenCalledOnce();
    const [project, from, to] = mockGetSessionsForProject.mock.calls[0];

    expect(project).toBe('my-app');

    // `to` should be close to now
    const toMs = new Date(to!).getTime();
    expect(toMs).toBeGreaterThanOrEqual(before);
    expect(toMs).toBeLessThanOrEqual(after);

    // `from` should be ~7 days before `to`
    const fromMs = new Date(from!).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(toMs - fromMs).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(toMs - fromMs).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });

  it('returns empty message when no sessions found', async () => {
    mockGetSessionsForProject.mockReturnValue([]);

    const result = await listSessionsTool.handler({ project: 'ghost-proj' });

    expect(result).toBe('No sessions found for project "ghost-proj".');
  });

  it('lists multiple sessions', async () => {
    mockGetSessionsForProject.mockReturnValue([
      ...sampleSessions,
      {
        sessionId: 'def67890-full-id',
        chunkCount: 12,
        totalTokens: 3400,
        firstChunkTime: '2025-01-16T10:00:00Z',
        lastChunkTime: '2025-01-16T12:30:00Z',
      },
    ]);

    const result = await listSessionsTool.handler({ project: 'my-app' });

    expect(result).toContain('2 total');
    expect(result).toContain('abc12345');
    expect(result).toContain('def67890');
  });
});

// ---------------------------------------------------------------------------
// reconstructTool.handler
// ---------------------------------------------------------------------------
describe('reconstructTool.handler', () => {
  const sampleReconstructResult = {
    chunks: [
      { id: 'r1', sessionId: 's1', text: 'chunk text', tokens: 100, startTime: '2025-01-15T14:30:00Z' },
    ],
    sessions: [{ sessionId: 's1', chunkCount: 1, totalTokens: 100, firstChunkTime: '2025-01-15T14:30:00Z', lastChunkTime: '2025-01-15T14:30:00Z' }],
    totalTokens: 100,
    truncated: false,
    timeRange: { from: '2025-01-15T00:00:00Z', to: '2025-01-15T23:59:59Z' },
  };

  it('calls reconstructSession and formatReconstruction, returns formatted string', async () => {
    mockReconstructSession.mockReturnValue(sampleReconstructResult);
    mockFormatReconstruction.mockReturnValue('--- Session s1 ---\nchunk text');

    const result = await reconstructTool.handler({ project: 'my-app' });

    expect(mockReconstructSession).toHaveBeenCalledOnce();
    expect(mockFormatReconstruction).toHaveBeenCalledWith(sampleReconstructResult);
    expect(result).toBe('--- Session s1 ---\nchunk text');
  });

  it('passes all optional params to reconstructSession', async () => {
    mockReconstructSession.mockReturnValue(sampleReconstructResult);
    mockFormatReconstruction.mockReturnValue('output');

    await reconstructTool.handler({
      project: 'my-app',
      session_id: 'sess-123',
      from: '2025-01-01T00:00:00Z',
      to: '2025-01-31T23:59:59Z',
      days_back: 14,
      previous_session: true,
      current_session_id: 'sess-current',
      keep_newest: false,
    });

    expect(mockReconstructSession).toHaveBeenCalledWith({
      project: 'my-app',
      sessionId: 'sess-123',
      from: '2025-01-01T00:00:00Z',
      to: '2025-01-31T23:59:59Z',
      daysBack: 14,
      previousSession: true,
      currentSessionId: 'sess-current',
      maxTokens: 2000,
      keepNewest: false,
    });
  });

  it('defaults keep_newest to true when not provided', async () => {
    mockReconstructSession.mockReturnValue(sampleReconstructResult);
    mockFormatReconstruction.mockReturnValue('output');

    await reconstructTool.handler({ project: 'my-app' });

    expect(mockReconstructSession).toHaveBeenCalledWith(
      expect.objectContaining({ keepNewest: true }),
    );
  });

  it('catches errors and returns "Error: ..." string', async () => {
    mockReconstructSession.mockImplementation(() => {
      throw new Error('currentSessionId is required when previousSession is true');
    });

    const result = await reconstructTool.handler({ project: 'my-app', previous_session: true });

    expect(result).toBe('Error: currentSessionId is required when previousSession is true');
    expect(mockFormatReconstruction).not.toHaveBeenCalled();
  });

  it('catches non-Error thrown values', async () => {
    mockReconstructSession.mockImplementation(() => {
      throw 'unexpected string error';  
    });

    const result = await reconstructTool.handler({ project: 'my-app' });

    expect(result).toBe('Error: unexpected string error');
  });
});
