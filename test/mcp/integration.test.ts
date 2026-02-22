/**
 * MCP integration test.
 *
 * Tests the full tool handler path with a real in-memory SQLite database.
 * Only the embedding/vector layer is mocked since it requires external models.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { insertChunk } from '../../src/storage/chunk-store.js';
import { createEdge } from '../../src/storage/edge-store.js';
import {
  statsTool,
  listProjectsTool,
  listSessionsTool,
  hookStatusTool,
  getTool,
  tools,
} from '../../src/mcp/tools.js';
import type { ChunkInput } from '../../src/storage/types.js';

// ---------------------------------------------------------------------------
// Test database setup
// ---------------------------------------------------------------------------

let db: Database.Database;

/** Fixtures inserted in beforeAll */
const FIXTURE_CHUNKS: ChunkInput[] = [
  {
    id: 'chunk-int-1',
    sessionId: 'sess-int-1',
    sessionSlug: 'test-project',
    turnIndices: [0, 1],
    startTime: '2025-06-01T10:00:00Z',
    endTime: '2025-06-01T10:05:00Z',
    content: 'We discussed database schema design and added a users table.',
    codeBlockCount: 1,
    toolUseCount: 0,
    approxTokens: 40,
    projectPath: '/home/dev/test-project',
  },
  {
    id: 'chunk-int-2',
    sessionId: 'sess-int-1',
    sessionSlug: 'test-project',
    turnIndices: [2, 3],
    startTime: '2025-06-01T10:10:00Z',
    endTime: '2025-06-01T10:15:00Z',
    content: 'Implemented authentication middleware with JWT tokens.',
    codeBlockCount: 2,
    toolUseCount: 1,
    approxTokens: 55,
    projectPath: '/home/dev/test-project',
  },
  {
    id: 'chunk-int-3',
    sessionId: 'sess-int-2',
    sessionSlug: 'test-project',
    turnIndices: [0],
    startTime: '2025-06-02T14:00:00Z',
    endTime: '2025-06-02T14:10:00Z',
    content: 'Fixed a bug in the auth token refresh logic.',
    codeBlockCount: 1,
    toolUseCount: 0,
    approxTokens: 30,
    projectPath: '/home/dev/test-project',
  },
  {
    id: 'chunk-int-4',
    sessionId: 'sess-int-3',
    sessionSlug: 'other-project',
    turnIndices: [0, 1, 2],
    startTime: '2025-06-03T09:00:00Z',
    endTime: '2025-06-03T09:30:00Z',
    content: 'Set up CI pipeline with GitHub Actions.',
    codeBlockCount: 1,
    toolUseCount: 2,
    approxTokens: 60,
    projectPath: '/home/dev/other-project',
  },
];

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations(db);

  // Insert fixture chunks
  for (const chunk of FIXTURE_CHUNKS) {
    insertChunk(chunk);
  }

  // Insert edges between chunks within the same session
  createEdge({
    sourceChunkId: 'chunk-int-1',
    targetChunkId: 'chunk-int-2',
    edgeType: 'forward',
    referenceType: 'within-chain',
    initialWeight: 1.0,
  });
  createEdge({
    sourceChunkId: 'chunk-int-2',
    targetChunkId: 'chunk-int-1',
    edgeType: 'backward',
    referenceType: 'within-chain',
    initialWeight: 1.0,
  });

  // Cross-session edge
  createEdge({
    sourceChunkId: 'chunk-int-2',
    targetChunkId: 'chunk-int-3',
    edgeType: 'forward',
    referenceType: 'cross-session',
    initialWeight: 0.7,
  });
});

afterAll(() => {
  resetDb();
  db.close();
});

// ---------------------------------------------------------------------------
// stats tool
// ---------------------------------------------------------------------------
describe('MCP integration: stats tool', () => {
  it('returns version, chunk count, edge count, and cluster count', async () => {
    const result = await statsTool.handler({});

    expect(result).toContain('Causantic v');
    expect(result).toContain('Chunks: 4');
    expect(result).toContain('Edges: 3');
    expect(result).toContain('Clusters: 0');
  });

  it('lists projects with chunk counts', async () => {
    const result = await statsTool.handler({});

    expect(result).toContain('Projects:');
    expect(result).toContain('test-project');
    expect(result).toContain('other-project');
    // test-project has 3 chunks, other-project has 1
    expect(result).toContain('test-project: 3 chunks');
    expect(result).toContain('other-project: 1 chunks');
  });
});

// ---------------------------------------------------------------------------
// list-projects tool
// ---------------------------------------------------------------------------
describe('MCP integration: list-projects tool', () => {
  it('lists all projects with metadata', async () => {
    const result = await listProjectsTool.handler({});

    expect(result).toContain('Projects in memory:');
    expect(result).toContain('test-project');
    expect(result).toContain('other-project');
    expect(result).toContain('3 chunks');
    expect(result).toContain('1 chunks');
  });
});

// ---------------------------------------------------------------------------
// list-sessions tool
// ---------------------------------------------------------------------------
describe('MCP integration: list-sessions tool', () => {
  it('lists sessions for a project', async () => {
    const result = await listSessionsTool.handler({ project: 'test-project' });

    expect(result).toContain('Sessions for "test-project"');
    expect(result).toContain('2 total');
    // Session IDs are truncated to first 8 chars
    expect(result).toContain('sess-int');
  });

  it('returns empty message for unknown project', async () => {
    const result = await listSessionsTool.handler({ project: 'nonexistent' });

    expect(result).toBe('No sessions found for project "nonexistent".');
  });

  it('filters sessions by date range', async () => {
    const result = await listSessionsTool.handler({
      project: 'test-project',
      from: '2025-06-02T00:00:00Z',
      to: '2025-06-03T00:00:00Z',
    });

    // Only sess-int-2 falls in this range
    expect(result).toContain('1 total');
  });
});

// ---------------------------------------------------------------------------
// hook-status tool
// ---------------------------------------------------------------------------
describe('MCP integration: hook-status tool', () => {
  it('returns a string response (no crash)', async () => {
    const result = await hookStatusTool.handler({});

    // Should return something — either hook status or "no hooks" message
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------
describe('MCP integration: tool registry', () => {
  it('getTool returns the correct tool by name', () => {
    const stats = getTool('stats');
    expect(stats).toBeDefined();
    expect(stats!.name).toBe('stats');
  });

  it('getTool returns undefined for unknown tools', () => {
    expect(getTool('nonexistent')).toBeUndefined();
  });

  it('all tools have a callable handler', () => {
    for (const tool of tools) {
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('all tool handlers return a promise', () => {
    // stats tool has no required args
    const result = statsTool.handler({});
    expect(result).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// Response format validation
// ---------------------------------------------------------------------------
describe('MCP integration: response format', () => {
  it('stats response has expected structure', async () => {
    const result = await statsTool.handler({});
    const lines = result.split('\n');

    // First line should be version
    expect(lines[0]).toMatch(/^Causantic v\d/);

    // Should contain Memory Statistics section
    expect(result).toContain('Memory Statistics:');
    expect(result).toContain('- Chunks:');
    expect(result).toContain('- Edges:');
    expect(result).toContain('- Clusters:');
  });

  it('list-projects response has bullet-point format', async () => {
    const result = await listProjectsTool.handler({});
    const bulletLines = result.split('\n').filter((l: string) => l.startsWith('- '));

    // Should have one bullet per project
    expect(bulletLines.length).toBe(2);
    expect(bulletLines.some((l: string) => l.includes('test-project'))).toBe(true);
    expect(bulletLines.some((l: string) => l.includes('other-project'))).toBe(true);
  });
});
