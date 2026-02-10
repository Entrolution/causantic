/**
 * Integration tests for dashboard API routes.
 *
 * Uses a real Express app with an in-memory test database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import Database from 'better-sqlite3-multiple-ciphers';
import { createTestDb, setupTestDb, teardownTestDb } from '../storage/test-utils.js';
import { createApp } from '../../src/dashboard/server.js';
import { insertChunk } from '../../src/storage/chunk-store.js';
import { createEdge } from '../../src/storage/edge-store.js';

let db: Database.Database;
let server: Server;
let baseUrl: string;

function get(path: string): Promise<{ status: number; json: () => Promise<any> }> {
  return globalThis.fetch(`${baseUrl}${path}`).then((res) => ({
    status: res.status,
    json: () => res.json(),
  }));
}

function makeChunk(overrides: Partial<{
  id: string;
  sessionId: string;
  sessionSlug: string;
  turnIndices: number[];
  content: string;
  startTime: string;
  endTime: string;
}> = {}) {
  return {
    id: overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: overrides.sessionId ?? 'sess-1',
    sessionSlug: overrides.sessionSlug ?? 'project-a',
    turnIndices: overrides.turnIndices ?? [0],
    content: overrides.content ?? 'Test content',
    approxTokens: 10,
    codeBlockCount: 0,
    toolUseCount: 0,
    startTime: overrides.startTime ?? '2024-01-01T00:00:00Z',
    endTime: overrides.endTime ?? '2024-01-01T00:01:00Z',
  };
}

beforeEach(async () => {
  db = createTestDb();
  setupTestDb(db);

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  teardownTestDb(db);
});

describe('GET /api/stats', () => {
  it('returns counts for empty database', async () => {
    const res = await get('/api/stats');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chunks).toBe(0);
    expect(data.edges).toBe(0);
    expect(data.clusters).toBe(0);
    expect(data.sessions).toBe(0);
    expect(data.chunkTimeSeries).toEqual([]);
  });

  it('returns correct counts after inserting data', async () => {
    insertChunk(makeChunk({ id: 'chunk-1' }));

    const res = await get('/api/stats');
    const data = await res.json();

    expect(data.chunks).toBe(1);
    expect(data.sessions).toBe(1);
  });
});

describe('GET /api/chunks', () => {
  it('returns empty list for empty database', async () => {
    const res = await get('/api/chunks');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chunks).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.page).toBe(1);
  });

  it('returns chunks with pagination', async () => {
    for (let i = 0; i < 3; i++) {
      insertChunk(makeChunk({
        id: `chunk-${i}`,
        startTime: `2024-01-0${i + 1}T00:00:00Z`,
        endTime: `2024-01-0${i + 1}T00:01:00Z`,
      }));
    }

    const res = await get('/api/chunks?page=1&limit=2');
    const data = await res.json();

    expect(data.chunks).toHaveLength(2);
    expect(data.total).toBe(3);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(2);
  });

  it('filters by project', async () => {
    insertChunk(makeChunk({ id: 'chunk-a', sessionSlug: 'project-a' }));
    insertChunk(makeChunk({
      id: 'chunk-b',
      sessionId: 'sess-2',
      sessionSlug: 'project-b',
      startTime: '2024-01-02T00:00:00Z',
    }));

    const res = await get('/api/chunks?project=project-a');
    const data = await res.json();

    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0].sessionSlug).toBe('project-a');
  });
});

describe('GET /api/edges', () => {
  it('returns empty list for empty database', async () => {
    const res = await get('/api/edges');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.edges).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('returns edges after inserting data', async () => {
    insertChunk(makeChunk({ id: 'chunk-1' }));
    insertChunk(makeChunk({
      id: 'chunk-2',
      startTime: '2024-01-01T00:01:00Z',
      endTime: '2024-01-01T00:02:00Z',
    }));
    createEdge({
      sourceChunkId: 'chunk-1',
      targetChunkId: 'chunk-2',
      edgeType: 'backward',
      initialWeight: 1.0,
    });

    const res = await get('/api/edges');
    const data = await res.json();

    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].source).toBe('chunk-1');
    expect(data.edges[0].target).toBe('chunk-2');
    expect(data.edges[0].type).toBe('backward');
  });

  it('filters edges by chunkId', async () => {
    insertChunk(makeChunk({ id: 'c1' }));
    insertChunk(makeChunk({ id: 'c2' }));
    insertChunk(makeChunk({ id: 'c3' }));
    createEdge({ sourceChunkId: 'c1', targetChunkId: 'c2', edgeType: 'backward', initialWeight: 1.0 });
    createEdge({ sourceChunkId: 'c2', targetChunkId: 'c3', edgeType: 'backward', initialWeight: 1.0 });

    const res = await get('/api/edges?chunkId=c2');
    const data = await res.json();

    // c2 has one outgoing (c2→c3) and one incoming (c1→c2)
    expect(data.edges).toHaveLength(2);
  });
});

describe('GET /api/projects', () => {
  it('returns empty list for empty database', async () => {
    const res = await get('/api/projects');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.projects).toEqual([]);
  });

  it('returns distinct projects', async () => {
    insertChunk(makeChunk({ id: 'c1', sessionSlug: 'project-a' }));
    insertChunk(makeChunk({ id: 'c2', sessionId: 'sess-2', sessionSlug: 'project-b' }));

    const res = await get('/api/projects');
    const data = await res.json();

    expect(data.projects).toHaveLength(2);
  });
});

describe('GET /api/clusters', () => {
  it('returns empty list for empty database', async () => {
    const res = await get('/api/clusters');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.clusters).toEqual([]);
  });
});

describe('GET /api/search', () => {
  it('returns 400 when q parameter is missing', async () => {
    const res = await get('/api/search');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('q is required');
  });

  it('returns results for keyword search', async () => {
    insertChunk(makeChunk({
      id: 'chunk-1',
      content: 'TypeScript compiler error handling guide',
    }));

    const res = await get('/api/search?q=typescript+compiler');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
  });
});

describe('GET /api/graph', () => {
  it('returns empty graph for empty database', async () => {
    const res = await get('/api/graph');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('returns graph with nodes and edges', async () => {
    insertChunk(makeChunk({ id: 'c1' }));
    insertChunk(makeChunk({ id: 'c2' }));
    createEdge({ sourceChunkId: 'c1', targetChunkId: 'c2', edgeType: 'backward', initialWeight: 1.0 });

    const res = await get('/api/graph');
    const data = await res.json();

    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
  });
});

describe('GET /api/graph/neighborhood', () => {
  it('returns 400 when chunkId is missing', async () => {
    const res = await get('/api/graph/neighborhood');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('chunkId is required');
  });

  it('returns neighborhood for a seed node', async () => {
    insertChunk(makeChunk({ id: 'c1' }));
    insertChunk(makeChunk({ id: 'c2' }));
    insertChunk(makeChunk({ id: 'c3' }));
    createEdge({ sourceChunkId: 'c1', targetChunkId: 'c2', edgeType: 'backward', initialWeight: 1.0 });
    createEdge({ sourceChunkId: 'c2', targetChunkId: 'c3', edgeType: 'backward', initialWeight: 1.0 });

    const res = await get('/api/graph/neighborhood?chunkId=c1&hops=2');
    const data = await res.json();

    // 2-hop from c1: c1 → c2 → c3
    expect(data.nodes.length).toBeGreaterThanOrEqual(2);
    expect(data.edges.length).toBeGreaterThanOrEqual(1);
    // Root node should be marked
    const root = data.nodes.find((n: any) => n.id === 'c1');
    expect(root?.root).toBe(true);
  });
});

describe('GET /api/sessions', () => {
  it('returns 400 when project parameter is missing', async () => {
    const res = await get('/api/sessions');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('project query parameter is required');
  });

  it('returns empty sessions for unknown project', async () => {
    const res = await get('/api/sessions?project=nonexistent');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toEqual([]);
  });

  it('returns sessions for a project', async () => {
    // Insert 2 chunks with same sessionSlug but different sessionId
    insertChunk(makeChunk({
      id: 'sess-chunk-1',
      sessionId: 'session-alpha',
      sessionSlug: 'my-project',
      startTime: '2024-03-01T10:00:00Z',
      endTime: '2024-03-01T10:05:00Z',
    }));
    insertChunk(makeChunk({
      id: 'sess-chunk-2',
      sessionId: 'session-alpha',
      sessionSlug: 'my-project',
      startTime: '2024-03-01T10:05:00Z',
      endTime: '2024-03-01T10:10:00Z',
    }));
    insertChunk(makeChunk({
      id: 'sess-chunk-3',
      sessionId: 'session-beta',
      sessionSlug: 'my-project',
      startTime: '2024-03-02T12:00:00Z',
      endTime: '2024-03-02T12:30:00Z',
    }));

    const res = await get('/api/sessions?project=my-project');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toHaveLength(2);

    // Ordered by firstChunkTime DESC, so session-beta first
    expect(data.sessions[0].sessionId).toBe('session-beta');
    expect(data.sessions[0].chunkCount).toBe(1);

    expect(data.sessions[1].sessionId).toBe('session-alpha');
    expect(data.sessions[1].chunkCount).toBe(2);
    expect(data.sessions[1].totalTokens).toBe(20); // 2 chunks * 10 approxTokens
  });

  it('supports from/to date filtering', async () => {
    insertChunk(makeChunk({
      id: 'filter-chunk-1',
      sessionId: 'sess-early',
      sessionSlug: 'filtered-proj',
      startTime: '2024-01-10T08:00:00Z',
      endTime: '2024-01-10T09:00:00Z',
    }));
    insertChunk(makeChunk({
      id: 'filter-chunk-2',
      sessionId: 'sess-late',
      sessionSlug: 'filtered-proj',
      startTime: '2024-06-15T14:00:00Z',
      endTime: '2024-06-15T15:00:00Z',
    }));

    // Filter to only include chunks from March onwards
    const res = await get('/api/sessions?project=filtered-proj&from=2024-03-01T00:00:00Z');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].sessionId).toBe('sess-late');

    // Filter with both from and to
    const res2 = await get(
      '/api/sessions?project=filtered-proj&from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z'
    );
    const data2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(data2.sessions).toHaveLength(1);
    expect(data2.sessions[0].sessionId).toBe('sess-early');
  });
});

describe('GET /api/benchmark-collection/history', () => {
  it('returns 200 with empty runs array on fresh database', async () => {
    const res = await get('/api/benchmark-collection/history');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.runs).toEqual([]);
  });
});
