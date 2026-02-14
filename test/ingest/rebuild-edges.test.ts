/**
 * Tests for edge rebuilding using sequential linked-list structure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredChunk } from '../../src/storage/types.js';

function makeStoredChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    id: 'chunk-1',
    content: 'Test content',
    sessionId: 'session-1',
    sessionSlug: 'proj-a',
    turnIndices: [0],
    startTime: '2025-01-01T00:00:00Z',
    endTime: '2025-01-01T00:01:00Z',
    codeBlockCount: 0,
    toolUseCount: 0,
    approxTokens: 50,
    projectPath: '/test/path',
    ...overrides,
  };
}

// Mock chunk-store
const mockGetSessionIds = vi.fn();
const mockGetChunksBySession = vi.fn();
vi.mock('../../src/storage/chunk-store.js', () => ({
  getSessionIds: (...args: unknown[]) => mockGetSessionIds(...args),
  getChunksBySession: (...args: unknown[]) => mockGetChunksBySession(...args),
}));

// Mock edge-store
const mockDeleteEdgesForSession = vi.fn();
vi.mock('../../src/storage/edge-store.js', () => ({
  deleteEdgesForSession: (...args: unknown[]) => mockDeleteEdgesForSession(...args),
}));

// Mock edge-detector
const mockDetectCausalTransitions = vi.fn();
vi.mock('../../src/ingest/edge-detector.js', () => ({
  detectCausalTransitions: (...args: unknown[]) => mockDetectCausalTransitions(...args),
}));

// Mock edge-creator
const mockCreateEdgesFromTransitions = vi.fn();
const mockCreateCrossSessionEdges = vi.fn();
vi.mock('../../src/ingest/edge-creator.js', () => ({
  createEdgesFromTransitions: (...args: unknown[]) => mockCreateEdgesFromTransitions(...args),
  createCrossSessionEdges: (...args: unknown[]) => mockCreateCrossSessionEdges(...args),
}));

import { rebuildEdges } from '../../src/ingest/rebuild-edges.js';

describe('rebuildEdges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectCausalTransitions.mockReturnValue([]);
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 0 });
    mockDeleteEdgesForSession.mockReturnValue(0);
    mockCreateCrossSessionEdges.mockResolvedValue(1);
  });

  it('should return zero counts for empty database', async () => {
    mockGetSessionIds.mockReturnValue([]);

    const result = await rebuildEdges();

    expect(result.sessionsProcessed).toBe(0);
    expect(result.edgesDeleted).toBe(0);
    expect(result.edgesCreated).toBe(0);
  });

  it('should process sessions with chunks', async () => {
    mockGetSessionIds.mockReturnValue(['s1']);
    mockGetChunksBySession.mockReturnValue([
      makeStoredChunk({ id: 'c1', sessionId: 's1' }),
      makeStoredChunk({ id: 'c2', sessionId: 's1' }),
    ]);
    mockDeleteEdgesForSession.mockReturnValue(5);
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 3 });

    const result = await rebuildEdges();

    expect(result.sessionsProcessed).toBe(1);
    expect(result.edgesDeleted).toBe(5);
    expect(result.edgesCreated).toBe(3);
    expect(mockDetectCausalTransitions).toHaveBeenCalledTimes(1);
  });

  it('should skip sessions with no chunks', async () => {
    mockGetSessionIds.mockReturnValue(['s1', 's2']);
    mockGetChunksBySession.mockImplementation((sessionId: string) => {
      if (sessionId === 's1') {
        return [makeStoredChunk({ id: 'c1', sessionId: 's1' })];
      }
      return []; // s2 has no chunks
    });
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 1 });

    const result = await rebuildEdges();

    expect(result.sessionsProcessed).toBe(1); // Only s1 processed
  });

  it('should create cross-session edges for same project', async () => {
    mockGetSessionIds.mockReturnValue(['s1', 's2']);
    mockGetChunksBySession.mockImplementation((sessionId: string) => {
      if (sessionId === 's1') {
        return [
          makeStoredChunk({
            id: 'c1',
            sessionId: 's1',
            sessionSlug: 'proj-a',
            startTime: '2025-01-01T00:00:00Z',
          }),
          makeStoredChunk({
            id: 'c2',
            sessionId: 's1',
            sessionSlug: 'proj-a',
            startTime: '2025-01-01T00:01:00Z',
          }),
        ];
      }
      return [
        makeStoredChunk({
          id: 'c3',
          sessionId: 's2',
          sessionSlug: 'proj-a',
          startTime: '2025-01-02T00:00:00Z',
        }),
      ];
    });
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 1 });
    mockCreateCrossSessionEdges.mockResolvedValue(1);

    const result = await rebuildEdges();

    expect(result.sessionsProcessed).toBe(2);
    // Cross-session: last chunk of s1 (c2) → first chunk of s2 (c3)
    expect(mockCreateCrossSessionEdges).toHaveBeenCalledWith('c2', 'c3');
    // 1 edge per session + 1 cross-session = 3
    expect(result.edgesCreated).toBe(3);
  });

  it('should not create cross-session edges for different projects', async () => {
    mockGetSessionIds.mockReturnValue(['s1', 's2']);
    mockGetChunksBySession.mockImplementation((sessionId: string) => {
      if (sessionId === 's1') {
        return [
          makeStoredChunk({
            id: 'c1',
            sessionId: 's1',
            sessionSlug: 'proj-a',
            startTime: '2025-01-01T00:00:00Z',
          }),
        ];
      }
      return [
        makeStoredChunk({
          id: 'c2',
          sessionId: 's2',
          sessionSlug: 'proj-b', // Different project
          startTime: '2025-01-02T00:00:00Z',
        }),
      ];
    });
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 0 });

    await rebuildEdges();

    expect(mockCreateCrossSessionEdges).not.toHaveBeenCalled();
  });

  it('should call progress callback', async () => {
    mockGetSessionIds.mockReturnValue(['s1']);
    mockGetChunksBySession.mockReturnValue([
      makeStoredChunk({ id: 'c1', sessionId: 's1' }),
    ]);
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 1 });

    const messages: string[] = [];
    await rebuildEdges((msg) => messages.push(msg));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('Session'))).toBe(true);
  });

  it('should sort sessions by first chunk start time', async () => {
    mockGetSessionIds.mockReturnValue(['s1', 's2']);
    // s2 has earlier start time
    mockGetChunksBySession.mockImplementation((sessionId: string) => {
      if (sessionId === 's1') {
        return [
          makeStoredChunk({
            id: 'c1',
            sessionId: 's1',
            sessionSlug: 'proj-a',
            startTime: '2025-01-02T00:00:00Z',
          }),
        ];
      }
      return [
        makeStoredChunk({
          id: 'c2',
          sessionId: 's2',
          sessionSlug: 'proj-a',
          startTime: '2025-01-01T00:00:00Z',
        }),
      ];
    });
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 0 });
    mockCreateCrossSessionEdges.mockResolvedValue(1);

    await rebuildEdges();

    // Cross-session should link s2 (earlier) → s1 (later): last chunk of s2 → first chunk of s1
    expect(mockCreateCrossSessionEdges).toHaveBeenCalledWith('c2', 'c1');
  });

  it('should convert stored chunks to parser format', async () => {
    mockGetSessionIds.mockReturnValue(['s1']);
    const storedChunk = makeStoredChunk({
      id: 'c1',
      content: 'Test content',
      sessionId: 's1',
      turnIndices: [0, 1],
      codeBlockCount: 2,
      toolUseCount: 3,
      approxTokens: 100,
    });
    mockGetChunksBySession.mockReturnValue([storedChunk]);
    mockCreateEdgesFromTransitions.mockResolvedValue({ totalCount: 0 });

    await rebuildEdges();

    // Verify the transition detector received parser-format chunks
    const parserChunks = mockDetectCausalTransitions.mock.calls[0][0];
    expect(parserChunks).toHaveLength(1);
    expect(parserChunks[0].id).toBe('c1');
    expect(parserChunks[0].text).toBe('Test content');
    expect(parserChunks[0].metadata.turnIndices).toEqual([0, 1]);
    expect(parserChunks[0].metadata.codeBlockCount).toBe(2);
    expect(parserChunks[0].metadata.toolUseCount).toBe(3);
    expect(parserChunks[0].metadata.approxTokens).toBe(100);
  });
});
