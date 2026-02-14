/**
 * Integration tests for dashboard API routes.
 *
 * Uses a real Express app with an in-memory test database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  setupTestDb,
  teardownTestDb,
  insertTestCluster,
  assignChunkToCluster,
} from '../storage/test-utils.js';
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

function makeChunk(
  overrides: Partial<{
    id: string;
    sessionId: string;
    sessionSlug: string;
    turnIndices: number[];
    content: string;
    startTime: string;
    endTime: string;
  }> = {},
) {
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
      insertChunk(
        makeChunk({
          id: `chunk-${i}`,
          startTime: `2024-01-0${i + 1}T00:00:00Z`,
          endTime: `2024-01-0${i + 1}T00:01:00Z`,
        }),
      );
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
    insertChunk(
      makeChunk({
        id: 'chunk-b',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        startTime: '2024-01-02T00:00:00Z',
      }),
    );

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
    insertChunk(
      makeChunk({
        id: 'chunk-2',
        startTime: '2024-01-01T00:01:00Z',
        endTime: '2024-01-01T00:02:00Z',
      }),
    );
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
    createEdge({
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
      initialWeight: 1.0,
    });
    createEdge({
      sourceChunkId: 'c2',
      targetChunkId: 'c3',
      edgeType: 'backward',
      initialWeight: 1.0,
    });

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
    insertChunk(
      makeChunk({
        id: 'chunk-1',
        content: 'TypeScript compiler error handling guide',
      }),
    );

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
    createEdge({
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
      initialWeight: 1.0,
    });

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
    createEdge({
      sourceChunkId: 'c1',
      targetChunkId: 'c2',
      edgeType: 'backward',
      initialWeight: 1.0,
    });
    createEdge({
      sourceChunkId: 'c2',
      targetChunkId: 'c3',
      edgeType: 'backward',
      initialWeight: 1.0,
    });

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
    insertChunk(
      makeChunk({
        id: 'sess-chunk-1',
        sessionId: 'session-alpha',
        sessionSlug: 'my-project',
        startTime: '2024-03-01T10:00:00Z',
        endTime: '2024-03-01T10:05:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'sess-chunk-2',
        sessionId: 'session-alpha',
        sessionSlug: 'my-project',
        startTime: '2024-03-01T10:05:00Z',
        endTime: '2024-03-01T10:10:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'sess-chunk-3',
        sessionId: 'session-beta',
        sessionSlug: 'my-project',
        startTime: '2024-03-02T12:00:00Z',
        endTime: '2024-03-02T12:30:00Z',
      }),
    );

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
    insertChunk(
      makeChunk({
        id: 'filter-chunk-1',
        sessionId: 'sess-early',
        sessionSlug: 'filtered-proj',
        startTime: '2024-01-10T08:00:00Z',
        endTime: '2024-01-10T09:00:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'filter-chunk-2',
        sessionId: 'sess-late',
        sessionSlug: 'filtered-proj',
        startTime: '2024-06-15T14:00:00Z',
        endTime: '2024-06-15T15:00:00Z',
      }),
    );

    // Filter to only include chunks from March onwards
    const res = await get('/api/sessions?project=filtered-proj&from=2024-03-01T00:00:00Z');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].sessionId).toBe('sess-late');

    // Filter with both from and to
    const res2 = await get(
      '/api/sessions?project=filtered-proj&from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z',
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

describe('GET /api/timeline', () => {
  it('returns empty timeline for empty database', async () => {
    const res = await get('/api/timeline');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.chunks).toEqual([]);
    expect(data.edges).toEqual([]);
    expect(data.timeRange.earliest).toBeNull();
    expect(data.timeRange.latest).toBeNull();
  });

  it('returns chunks ordered by time', async () => {
    insertChunk(
      makeChunk({
        id: 'tl-1',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:05:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'tl-2',
        startTime: '2024-01-01T10:05:00Z',
        endTime: '2024-01-01T10:10:00Z',
      }),
    );

    const res = await get('/api/timeline');
    const data = await res.json();

    expect(data.chunks).toHaveLength(2);
    expect(data.chunks[0].id).toBe('tl-1');
    expect(data.chunks[1].id).toBe('tl-2');
    expect(data.timeRange.earliest).toBe('2024-01-01T10:00:00Z');
    expect(data.timeRange.latest).toBe('2024-01-01T10:05:00Z');
  });

  it('returns edges where both endpoints are in chunk set', async () => {
    insertChunk(
      makeChunk({
        id: 'tl-e1',
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T10:05:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'tl-e2',
        startTime: '2024-02-01T10:05:00Z',
        endTime: '2024-02-01T10:10:00Z',
      }),
    );
    createEdge({
      sourceChunkId: 'tl-e1',
      targetChunkId: 'tl-e2',
      edgeType: 'forward',
      referenceType: 'within-chain',
      initialWeight: 1.0,
    });

    const res = await get('/api/timeline');
    const data = await res.json();

    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].sourceId).toBe('tl-e1');
    expect(data.edges[0].targetId).toBe('tl-e2');
    expect(data.edges[0].referenceType).toBe('within-chain');
  });

  it('filters by project', async () => {
    insertChunk(
      makeChunk({
        id: 'tl-pa',
        sessionSlug: 'project-a',
        startTime: '2024-01-01T10:00:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'tl-pb',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        startTime: '2024-01-01T10:00:00Z',
      }),
    );

    const res = await get('/api/timeline?project=project-a');
    const data = await res.json();

    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0].id).toBe('tl-pa');
  });

  it('respects time range filter', async () => {
    insertChunk(
      makeChunk({
        id: 'tl-early',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:05:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'tl-late',
        startTime: '2024-06-15T10:00:00Z',
        endTime: '2024-06-15T10:05:00Z',
      }),
    );

    const res = await get('/api/timeline?from=2024-03-01T00:00:00Z');
    const data = await res.json();

    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0].id).toBe('tl-late');
  });
});

describe('GET /api/chain/walk', () => {
  it('returns 400 when chunkId is missing', async () => {
    const res = await get('/api/chain/walk');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('chunkId is required');
  });

  it('returns empty chain for chunk with no edges', async () => {
    insertChunk(makeChunk({ id: 'chain-solo' }));

    const res = await get('/api/chain/walk?chunkId=chain-solo');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seed.id).toBe('chain-solo');
    expect(data.chain).toEqual([]);
    expect(data.direction).toBe('backward');
  });

  it('walks forward chain', async () => {
    insertChunk(
      makeChunk({
        id: 'chain-a',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:05:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'chain-b',
        startTime: '2024-01-01T10:05:00Z',
        endTime: '2024-01-01T10:10:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'chain-c',
        startTime: '2024-01-01T10:10:00Z',
        endTime: '2024-01-01T10:15:00Z',
      }),
    );
    createEdge({
      sourceChunkId: 'chain-a',
      targetChunkId: 'chain-b',
      edgeType: 'forward',
      referenceType: 'within-chain',
      initialWeight: 1.0,
    });
    createEdge({
      sourceChunkId: 'chain-b',
      targetChunkId: 'chain-c',
      edgeType: 'forward',
      referenceType: 'within-chain',
      initialWeight: 1.0,
    });

    const res = await get('/api/chain/walk?chunkId=chain-a&direction=forward');
    const data = await res.json();

    expect(data.seed.id).toBe('chain-a');
    expect(data.chain).toHaveLength(2);
    expect(data.chain[0].id).toBe('chain-b');
    expect(data.chain[1].id).toBe('chain-c');
    expect(data.direction).toBe('forward');
    expect(data.totalTokens).toBe(30); // 3 chunks * 10 approxTokens
  });

  it('walks backward chain', async () => {
    insertChunk(makeChunk({ id: 'bk-a' }));
    insertChunk(makeChunk({ id: 'bk-b' }));
    createEdge({
      sourceChunkId: 'bk-a',
      targetChunkId: 'bk-b',
      edgeType: 'forward',
      referenceType: 'within-chain',
      initialWeight: 1.0,
    });

    const res = await get('/api/chain/walk?chunkId=bk-b&direction=backward');
    const data = await res.json();

    expect(data.seed.id).toBe('bk-b');
    expect(data.chain).toHaveLength(1);
    expect(data.chain[0].id).toBe('bk-a');
  });

  it('returns 400 for invalid direction', async () => {
    insertChunk(makeChunk({ id: 'dir-test' }));

    const res = await get('/api/chain/walk?chunkId=dir-test&direction=sideways');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('direction must be backward or forward');
  });

  it('returns empty fields for nonexistent chunkId', async () => {
    const res = await get('/api/chain/walk?chunkId=nonexistent');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.seed.id).toBe('nonexistent');
    expect(data.seed.sessionSlug).toBe('');
    expect(data.seed.preview).toBe('');
    expect(data.seed.approxTokens).toBe(0);
    expect(data.chain).toEqual([]);
  });
});

describe('GET /api/stats — full counts', () => {
  it('returns correct counts with multiple chunks, edges, clusters, and time series', async () => {
    insertChunk(
      makeChunk({
        id: 'stat-1',
        sessionId: 'sess-1',
        sessionSlug: 'project-a',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:01:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'stat-2',
        sessionId: 'sess-1',
        sessionSlug: 'project-a',
        startTime: '2024-01-02T00:00:00Z',
        endTime: '2024-01-02T00:01:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'stat-3',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        startTime: '2024-02-01T00:00:00Z',
        endTime: '2024-02-01T00:01:00Z',
      }),
    );
    createEdge({
      sourceChunkId: 'stat-1',
      targetChunkId: 'stat-2',
      edgeType: 'forward',
      initialWeight: 1.0,
    });
    insertTestCluster(db, {
      id: 'cluster-1',
      name: 'Test Cluster',
      exemplarIds: ['stat-1'],
    });

    const res = await get('/api/stats');
    const data = await res.json();

    expect(data.chunks).toBe(3);
    expect(data.edges).toBe(1);
    expect(data.clusters).toBe(1);
    expect(data.sessions).toBe(2);
    expect(data.projects).toBe(2);
    expect(data.chunkTimeSeries.length).toBeGreaterThanOrEqual(1);
    expect(data.chunkTimeSeries[0]).toHaveProperty('week');
    expect(data.chunkTimeSeries[0]).toHaveProperty('count');
  });
});

describe('GET /api/chunks — single lookup and pagination', () => {
  it('returns full content for single chunk lookup by chunkId', async () => {
    const longContent = 'A'.repeat(300);
    insertChunk(makeChunk({ id: 'single-1', content: longContent }));

    const res = await get('/api/chunks?chunkId=single-1');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0].content).toBe(longContent);
    expect(data.chunks[0].sessionId).toBeDefined();
    expect(data.chunks[0].approxTokens).toBeDefined();
  });

  it('returns page 2 correctly', async () => {
    for (let i = 0; i < 3; i++) {
      insertChunk(
        makeChunk({
          id: `pg-${i}`,
          startTime: `2024-01-0${i + 1}T00:00:00Z`,
          endTime: `2024-01-0${i + 1}T00:01:00Z`,
        }),
      );
    }

    const res = await get('/api/chunks?page=2&limit=2');
    const data = await res.json();

    expect(data.chunks).toHaveLength(1);
    expect(data.page).toBe(2);
    expect(data.total).toBe(3);
  });

  it('sorts by most recent first', async () => {
    insertChunk(
      makeChunk({
        id: 'old',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:01:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'new',
        startTime: '2024-06-01T00:00:00Z',
        endTime: '2024-06-01T00:01:00Z',
      }),
    );

    const res = await get('/api/chunks');
    const data = await res.json();

    expect(data.chunks[0].startTime).toBe('2024-06-01T00:00:00Z');
  });
});

describe('GET /api/edges — pagination', () => {
  it('returns page 2 correctly', async () => {
    insertChunk(makeChunk({ id: 'ep-1' }));
    insertChunk(makeChunk({ id: 'ep-2' }));
    insertChunk(makeChunk({ id: 'ep-3' }));
    createEdge({
      sourceChunkId: 'ep-1',
      targetChunkId: 'ep-2',
      edgeType: 'forward',
      initialWeight: 1.0,
    });
    createEdge({
      sourceChunkId: 'ep-2',
      targetChunkId: 'ep-3',
      edgeType: 'forward',
      initialWeight: 1.0,
    });

    const res = await get('/api/edges?page=2&limit=1');
    const data = await res.json();

    expect(data.edges).toHaveLength(1);
    expect(data.page).toBe(2);
    expect(data.total).toBe(2);
  });
});

describe('GET /api/clusters — with members', () => {
  it('returns cluster with member count and exemplar previews', async () => {
    const content1 = 'First chunk content for exemplar preview testing';
    const content2 = 'Second chunk content for cluster member';
    insertChunk(makeChunk({ id: 'cl-1', content: content1 }));
    insertChunk(makeChunk({ id: 'cl-2', content: content2 }));

    insertTestCluster(db, {
      id: 'test-cluster',
      name: 'My Cluster',
      description: 'A test cluster',
      exemplarIds: ['cl-1', 'cl-2'],
    });
    assignChunkToCluster(db, 'cl-1', 'test-cluster', 0.3);
    assignChunkToCluster(db, 'cl-2', 'test-cluster', 0.7);

    const res = await get('/api/clusters');
    const data = await res.json();

    expect(data.clusters).toHaveLength(1);
    const cluster = data.clusters[0];
    expect(cluster.id).toBe('test-cluster');
    expect(cluster.name).toBe('My Cluster');
    expect(cluster.description).toBe('A test cluster');
    expect(cluster.memberCount).toBe(2);
    expect(cluster.exemplarPreviews).toHaveLength(2);
    expect(cluster.exemplarPreviews[0]).toHaveProperty('id');
    expect(cluster.exemplarPreviews[0]).toHaveProperty('preview');
    expect(cluster.exemplarPreviews[0].preview).toBe(content1.slice(0, 150));
  });
});

describe('GET /api/graph — project filter and limit', () => {
  it('filters nodes by project', async () => {
    insertChunk(makeChunk({ id: 'gp-a1', sessionSlug: 'project-a' }));
    insertChunk(makeChunk({ id: 'gp-a2', sessionSlug: 'project-a' }));
    insertChunk(
      makeChunk({
        id: 'gp-b1',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        startTime: '2024-02-01T00:00:00Z',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'gp-b2',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        startTime: '2024-02-02T00:00:00Z',
      }),
    );
    createEdge({
      sourceChunkId: 'gp-a1',
      targetChunkId: 'gp-a2',
      edgeType: 'forward',
      initialWeight: 1.0,
    });
    createEdge({
      sourceChunkId: 'gp-b1',
      targetChunkId: 'gp-b2',
      edgeType: 'forward',
      initialWeight: 1.0,
    });

    const res = await get('/api/graph?project=project-a');
    const data = await res.json();

    // Only project-a nodes should appear
    for (const node of data.nodes) {
      expect(node.project).toBe('project-a');
    }
    expect(data.nodes.length).toBeGreaterThanOrEqual(1);
    expect(data.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit parameter', async () => {
    // Insert 5 chunks with edges to give them degree > 0
    for (let i = 0; i < 5; i++) {
      insertChunk(
        makeChunk({
          id: `gl-${i}`,
          startTime: `2024-01-0${i + 1}T00:00:00Z`,
          endTime: `2024-01-0${i + 1}T00:01:00Z`,
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      createEdge({
        sourceChunkId: `gl-${i}`,
        targetChunkId: `gl-${i + 1}`,
        edgeType: 'forward',
        initialWeight: 1.0,
      });
    }

    const res = await get('/api/graph?limit=10');
    const data = await res.json();

    // limit=10 but only 5 chunks exist — should get at most 5
    expect(data.nodes.length).toBeLessThanOrEqual(5);
    expect(data.nodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/graph/neighborhood — isolated node', () => {
  it('returns single node and no edges for isolated chunk', async () => {
    insertChunk(makeChunk({ id: 'solo-node' }));

    const res = await get('/api/graph/neighborhood?chunkId=solo-node');
    const data = await res.json();

    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].id).toBe('solo-node');
    expect(data.nodes[0].root).toBe(true);
    expect(data.edges).toHaveLength(0);
  });
});

describe('GET /api/search — project filter and no results', () => {
  it('filters results by project', async () => {
    insertChunk(
      makeChunk({
        id: 'srch-a',
        sessionSlug: 'project-a',
        content: 'TypeScript compilation pipeline architecture',
      }),
    );
    insertChunk(
      makeChunk({
        id: 'srch-b',
        sessionId: 'sess-2',
        sessionSlug: 'project-b',
        content: 'TypeScript type inference engine',
        startTime: '2024-02-01T00:00:00Z',
      }),
    );

    const res = await get('/api/search?q=typescript&project=project-a');
    const data = await res.json();

    expect(res.status).toBe(200);
    for (const result of data.results) {
      expect(result.sessionSlug).toBe('project-a');
    }
  });

  it('returns empty results for non-matching query', async () => {
    insertChunk(makeChunk({ id: 'srch-empty', content: 'hello world' }));

    const res = await get('/api/search?q=xyznonexistent');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toEqual([]);
  });
});

describe('GET /api/timeline — limit parameter', () => {
  it('respects limit parameter', async () => {
    for (let i = 0; i < 3; i++) {
      insertChunk(
        makeChunk({
          id: `tl-lim-${i}`,
          startTime: `2024-01-0${i + 1}T00:00:00Z`,
          endTime: `2024-01-0${i + 1}T00:01:00Z`,
        }),
      );
    }

    const res = await get('/api/timeline?limit=10');
    const data = await res.json();

    // limit=10 (min 10) but only 3 chunks — should return all 3
    expect(data.chunks).toHaveLength(3);

    // Also verify default limit works (not 0 chunks)
    const res2 = await get('/api/timeline');
    const data2 = await res2.json();
    expect(data2.chunks).toHaveLength(3);
  });
});
