/**
 * Tests for MCP server.
 *
 * Tests the McpServer class by invoking its private handleRequest method
 * directly, with all heavy dependencies mocked. This covers:
 * - Request routing to the correct handler
 * - Authentication enforcement and bypass
 * - Tool execution, unknown tools, and tool errors
 * - Initialize response structure
 * - Ping and health check responses
 * - Shutdown behaviour
 * - Unknown method handling
 * - Stats tracking (request/error counts)
 * - Graceful stop (idempotent, cleanup calls)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServerConfig } from '../../src/mcp/server.js';

// ---------------------------------------------------------------------------
// Mocks — must come before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/mcp/tools.js', () => {
  const fakeTool = {
    name: 'search',
    description: 'Search memory',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: vi.fn(async () => 'search result'),
  };
  const fakeTools = [fakeTool];
  return {
    tools: fakeTools,
    getTool: vi.fn((name: string) => fakeTools.find((t) => t.name === name)),
  };
});

vi.mock('../../src/storage/db.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => ({ '1': 1 })) })),
  })),
  closeDb: vi.fn(),
}));

vi.mock('../../src/retrieval/context-assembler.js', () => ({
  disposeRetrieval: vi.fn(async () => {}),
}));

vi.mock('../../src/storage/chunk-store.js', () => ({
  getChunkCount: vi.fn(() => 42),
}));

vi.mock('../../src/storage/edge-store.js', () => ({
  getEdgeCount: vi.fn(() => 10),
}));

vi.mock('../../src/storage/cluster-store.js', () => ({
  getClusterCount: vi.fn(() => 3),
}));

vi.mock('../../src/storage/vector-store.js', () => ({
  vectorStore: {},
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Now import the module under test + mocked deps
import { McpServer } from '../../src/mcp/server.js';
import { getTool, tools } from '../../src/mcp/tools.js';
import { closeDb } from '../../src/storage/db.js';
import { disposeRetrieval } from '../../src/retrieval/context-assembler.js';

const mockGetTool = vi.mocked(getTool);
const mockCloseDb = vi.mocked(closeDb);
const mockDisposeRetrieval = vi.mocked(disposeRetrieval);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for building a JSON-RPC request. */
function req(
  method: string,
  id: string | number = 1,
  params?: Record<string, unknown>,
): { jsonrpc: '2.0'; id: string | number; method: string; params?: Record<string, unknown> } {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

/** Call the private handleRequest on a McpServer instance. */
async function handle(
  server: McpServer,
  method: string,
  id: string | number = 1,
  params?: Record<string, unknown>,
) {
  return (server as any).handleRequest(req(method, id, params));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpServer', () => {
  let server: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer();
  });

  afterEach(async () => {
    // Ensure server is stopped to avoid leaking state between tests
    await server.stop();
  });

  // ─── Constructor & Config Defaults ──────────────────────────────────────

  describe('constructor defaults', () => {
    it('creates an instance with default config', () => {
      expect(server).toBeInstanceOf(McpServer);
    });

    it('getStats returns zero counts before any requests', () => {
      const stats = server.getStats();
      expect(stats.requestCount).toBe(0);
      expect(stats.errorCount).toBe(0);
    });

    it('accepts explicit config values', () => {
      const s = new McpServer({
        enableLogging: true,
        logLevel: 'error',
        authToken: 'tok-123',
        enableHealthCheck: false,
      });
      expect(s).toBeInstanceOf(McpServer);
    });
  });

  // ─── Initialize ─────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('returns protocol version and server info', async () => {
      const res = await handle(server, 'initialize');

      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      expect(res.result.protocolVersion).toBe('2024-11-05');
      expect(res.result.capabilities).toEqual({ tools: {} });
      expect(res.result.serverInfo.name).toBe('causantic');
      expect(res.result.serverInfo.version).toBeTruthy();
    });

    it('does not require authentication even when token is configured', async () => {
      const authServer = new McpServer({ authToken: 'secret' });
      const res = await handle(authServer, 'initialize');

      expect(res.error).toBeUndefined();
      expect(res.result.protocolVersion).toBe('2024-11-05');
    });
  });

  // ─── Ping ───────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('returns pong with timestamp', async () => {
      const res = await handle(server, 'ping');

      expect(res.result.pong).toBe(true);
      expect(typeof res.result.timestamp).toBe('number');
    });
  });

  // ─── tools/list ─────────────────────────────────────────────────────────

  describe('tools/list', () => {
    it('returns the tool list without handler functions', async () => {
      const res = await handle(server, 'tools/list');

      expect(res.result.tools).toHaveLength(1);
      expect(res.result.tools[0].name).toBe('search');
      expect(res.result.tools[0].description).toBe('Search memory');
      expect(res.result.tools[0]).not.toHaveProperty('handler');
    });
  });

  // ─── tools/call ─────────────────────────────────────────────────────────

  describe('tools/call', () => {
    it('executes a known tool and wraps result in content array', async () => {
      const res = await handle(server, 'tools/call', 1, {
        name: 'search',
        arguments: { query: 'auth flow' },
      });

      expect(res.result.content).toHaveLength(1);
      expect(res.result.content[0].type).toBe('text');
      expect(res.result.content[0].text).toBe('search result');

      // Verify the tool handler was called with the correct arguments
      const handler = tools[0].handler as ReturnType<typeof vi.fn>;
      expect(handler).toHaveBeenCalledWith({ query: 'auth flow' });
    });

    it('returns error for unknown tool', async () => {
      mockGetTool.mockReturnValueOnce(undefined);

      const res = await handle(server, 'tools/call', 2, {
        name: 'nonexistent',
        arguments: {},
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32602); // INVALID_PARAMS
      expect(res.error.message).toContain('Unknown tool: nonexistent');
    });

    it('returns tool error when handler throws', async () => {
      const throwingTool = {
        name: 'search',
        description: 'Search memory',
        inputSchema: { type: 'object', properties: {}, required: [] },
        handler: vi.fn(async () => {
          throw new Error('embedding service unavailable');
        }),
      };
      mockGetTool.mockReturnValueOnce(throwingTool as any);

      const res = await handle(server, 'tools/call', 3, {
        name: 'search',
        arguments: { query: 'test' },
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32002); // TOOL_ERROR
      expect(res.error.message).toContain('embedding service unavailable');
    });
  });

  // ─── Health Check ───────────────────────────────────────────────────────

  describe('health', () => {
    it('returns health status when enabled (default)', async () => {
      const res = await handle(server, 'health');

      expect(res.result).toBeDefined();
      expect(res.result.version).toBeTruthy();
      expect(res.result.checks).toBeDefined();
      expect(res.result.checks.database).toBe(true);
      expect(res.result.stats).toBeDefined();
      expect(res.result.stats.chunks).toBe(42);
      expect(res.result.stats.edges).toBe(10);
      expect(res.result.stats.clusters).toBe(3);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(res.result.status);
    });

    it('returns uptime as a number', async () => {
      const res = await handle(server, 'health');

      expect(typeof res.result.uptime).toBe('number');
    });

    it('returns error when health check is disabled', async () => {
      const noHealthServer = new McpServer({ enableHealthCheck: false });
      const res = await handle(noHealthServer, 'health');

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32601); // METHOD_NOT_FOUND
      expect(res.error.message).toContain('Health check disabled');
    });
  });

  // ─── Shutdown ───────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('returns null result', async () => {
      const res = await handle(server, 'shutdown');

      expect(res.jsonrpc).toBe('2.0');
      expect(res.result).toBeNull();
    });
  });

  // ─── Unknown Method ─────────────────────────────────────────────────────

  describe('unknown method', () => {
    it('returns METHOD_NOT_FOUND error', async () => {
      const res = await handle(server, 'some/unknown/method');

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32601);
      expect(res.error.message).toContain('Method not found');
      expect(res.error.message).toContain('some/unknown/method');
    });
  });

  // ─── Authentication ─────────────────────────────────────────────────────

  describe('authentication', () => {
    let authServer: McpServer;

    beforeEach(() => {
      authServer = new McpServer({ authToken: 'my-secret-token' });
    });

    afterEach(async () => {
      await authServer.stop();
    });

    it('allows initialize without auth token', async () => {
      const res = await handle(authServer, 'initialize');
      expect(res.error).toBeUndefined();
      expect(res.result.protocolVersion).toBe('2024-11-05');
    });

    it('rejects non-initialize request without token', async () => {
      const res = await handle(authServer, 'ping', 1, {});

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32001); // UNAUTHORIZED
      expect(res.error.message).toBe('Unauthorized');
    });

    it('rejects request with wrong token', async () => {
      const res = await handle(authServer, 'ping', 1, { _auth: 'wrong-token' });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32001);
    });

    it('allows request with correct token', async () => {
      const res = await handle(authServer, 'ping', 1, { _auth: 'my-secret-token' });

      expect(res.error).toBeUndefined();
      expect(res.result.pong).toBe(true);
    });

    it('allows tools/list with correct token', async () => {
      const res = await handle(authServer, 'tools/list', 1, { _auth: 'my-secret-token' });

      expect(res.error).toBeUndefined();
      expect(res.result.tools).toBeDefined();
    });

    it('rejects tools/call without token', async () => {
      const res = await handle(authServer, 'tools/call', 1, {
        name: 'search',
        arguments: { query: 'test' },
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32001);
    });

    it('allows tools/call with correct token', async () => {
      const res = await handle(authServer, 'tools/call', 1, {
        _auth: 'my-secret-token',
        name: 'search',
        arguments: { query: 'test' },
      });

      expect(res.error).toBeUndefined();
      expect(res.result.content).toBeDefined();
    });
  });

  describe('authentication disabled (no token)', () => {
    it('allows any request when no auth token is configured', async () => {
      const noAuthServer = new McpServer({ authToken: '' });
      const res = await handle(noAuthServer, 'ping');

      expect(res.error).toBeUndefined();
      expect(res.result.pong).toBe(true);
    });
  });

  // ─── Error Handling in handleRequest ────────────────────────────────────

  describe('error handling', () => {
    it('catches internal errors and returns INTERNAL_ERROR', async () => {
      // Force an unexpected error inside handleRequest by making initialize throw
      // We do this by temporarily replacing the private method
      const origInit = (server as any).handleInitialize;
      (server as any).handleInitialize = () => {
        throw new Error('unexpected boom');
      };

      const res = await handle(server, 'initialize');

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32603); // INTERNAL_ERROR
      expect(res.error.message).toBe('Internal error');
      expect(res.error.data).toBe('unexpected boom');

      // Restore
      (server as any).handleInitialize = origInit;
    });

    it('increments errorCount on internal error', async () => {
      const origInit = (server as any).handleInitialize;
      (server as any).handleInitialize = () => {
        throw new Error('kaboom');
      };

      await handle(server, 'initialize');

      expect(server.getStats().errorCount).toBe(1);

      (server as any).handleInitialize = origInit;
    });
  });

  // ─── JSON-RPC Response Structure ────────────────────────────────────────

  describe('response structure', () => {
    it('always includes jsonrpc and id', async () => {
      const res = await handle(server, 'ping', 'abc-123');

      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe('abc-123');
    });

    it('supports numeric request IDs', async () => {
      const res = await handle(server, 'ping', 42);

      expect(res.id).toBe(42);
    });

    it('error responses include code and message', async () => {
      const res = await handle(server, 'nonexistent');

      expect(res.error.code).toBe(-32601);
      expect(typeof res.error.message).toBe('string');
    });
  });

  // ─── Stop / Graceful Shutdown ───────────────────────────────────────────

  describe('stop', () => {
    it('calls disposeRetrieval and closeDb', async () => {
      // Need to make the server "running" first
      (server as any).running = true;
      await server.stop();

      expect(mockDisposeRetrieval).toHaveBeenCalledOnce();
      expect(mockCloseDb).toHaveBeenCalledOnce();
    });

    it('is idempotent — second stop is a no-op', async () => {
      (server as any).running = true;
      await server.stop();
      await server.stop();

      expect(mockDisposeRetrieval).toHaveBeenCalledTimes(1);
      expect(mockCloseDb).toHaveBeenCalledTimes(1);
    });

    it('handles errors during shutdown gracefully', async () => {
      mockDisposeRetrieval.mockRejectedValueOnce(new Error('dispose failed'));
      (server as any).running = true;

      // Should not throw
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  // ─── Stats Tracking ─────────────────────────────────────────────────────

  describe('stats tracking', () => {
    it('getStats returns uptime as a number', () => {
      const stats = server.getStats();
      expect(typeof stats.uptime).toBe('number');
    });
  });

  // ─── McpServerConfig Interface ──────────────────────────────────────────

  describe('McpServerConfig interface', () => {
    it('supports logging configuration', () => {
      const config: McpServerConfig = {
        enableLogging: true,
        logLevel: 'debug',
      };

      expect(config.enableLogging).toBe(true);
      expect(config.logLevel).toBe('debug');
    });

    it('supports authentication token', () => {
      const config: McpServerConfig = {
        authToken: 'secret-token-123',
      };

      expect(config.authToken).toBe('secret-token-123');
    });

    it('supports health check toggle', () => {
      const config: McpServerConfig = {
        enableHealthCheck: false,
      };

      expect(config.enableHealthCheck).toBe(false);
    });

    it('accepts all log levels', () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const config: McpServerConfig = { logLevel: level };
        expect(config.logLevel).toBe(level);
      }
    });
  });
});
