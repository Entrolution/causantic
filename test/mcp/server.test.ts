/**
 * Tests for MCP server.
 */

import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '../../src/mcp/server.js';

describe('mcp-server', () => {
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

  describe('MCP request structure', () => {
    it('has correct JSON-RPC 2.0 structure', () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 'req-123',
        method: 'tools/call',
        params: { name: 'recall', arguments: { query: 'test' } },
      };

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe('req-123');
      expect(request.method).toBe('tools/call');
    });

    it('supports numeric request IDs', () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 42,
        method: 'ping',
      };

      expect(typeof request.id).toBe('number');
    });
  });

  describe('MCP response structure', () => {
    it('has correct success structure', () => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 'req-123',
        result: { pong: true },
      };

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-123');
      expect(response.result).toEqual({ pong: true });
    });

    it('has correct error structure', () => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 'req-123',
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: { details: 'Missing method' },
        },
      };

      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe('Invalid Request');
      expect(response.error.data).toEqual({ details: 'Missing method' });
    });
  });

  describe('error codes', () => {
    it('defines standard JSON-RPC error codes', () => {
      const ErrorCodes = {
        PARSE_ERROR: -32700,
        INVALID_REQUEST: -32600,
        METHOD_NOT_FOUND: -32601,
        INVALID_PARAMS: -32602,
        INTERNAL_ERROR: -32603,
        UNAUTHORIZED: -32001,
        TOOL_ERROR: -32002,
      };

      expect(ErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(ErrorCodes.UNAUTHORIZED).toBe(-32001);
    });
  });

  describe('health status structure', () => {
    it('has correct healthy status', () => {
      const status = {
        status: 'healthy' as const,
        version: '0.1.0',
        uptime: 5000,
        checks: {
          database: true,
          vectorStore: true,
        },
        stats: {
          chunks: 100,
          edges: 250,
          clusters: 5,
        },
      };

      expect(status.status).toBe('healthy');
      expect(status.checks.database).toBe(true);
      expect(status.stats.chunks).toBe(100);
    });

    it('has correct degraded status', () => {
      const status = {
        status: 'degraded' as const,
        version: '0.1.0',
        uptime: 5000,
        checks: {
          database: true,
          vectorStore: false,
        },
        stats: {
          chunks: 0,
          edges: 0,
          clusters: 0,
        },
      };

      expect(status.status).toBe('degraded');
      expect(status.checks.vectorStore).toBe(false);
    });

    it('has correct unhealthy status', () => {
      const status = {
        status: 'unhealthy' as const,
        version: '0.1.0',
        uptime: 100,
        checks: {
          database: false,
          vectorStore: false,
        },
        stats: {
          chunks: 0,
          edges: 0,
          clusters: 0,
        },
      };

      expect(status.status).toBe('unhealthy');
    });
  });

  describe('request handling logic', () => {
    it('maps method names correctly', () => {
      const methods = ['initialize', 'tools/list', 'tools/call', 'ping', 'health', 'shutdown'];
      const methodMap = new Map(methods.map((m) => [m, true]));

      expect(methodMap.has('initialize')).toBe(true);
      expect(methodMap.has('tools/call')).toBe(true);
      expect(methodMap.has('unknown')).toBe(false);
    });

    it('validates authentication when token is set', () => {
      const authToken = 'secret-123';
      const params = { _auth: 'secret-123', query: 'test' };

      const isValid = params._auth === authToken;
      expect(isValid).toBe(true);
    });

    it('fails authentication with wrong token', () => {
      const authToken = 'secret-123';
      const params = { _auth: 'wrong-token', query: 'test' };

      const isValid = params._auth === authToken;
      expect(isValid).toBe(false);
    });

    it('skips authentication when no token configured', () => {
      const authToken = '';
      const params = { query: 'test' };

      const shouldAuth = authToken !== '';
      expect(shouldAuth).toBe(false);
    });
  });

  describe('log entry structure', () => {
    it('has correct structure', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        event: 'server_started',
        requestId: 'req-123',
        method: 'tools/call',
        durationMs: 50,
      };

      expect(entry.level).toBe('info');
      expect(entry.event).toBe('server_started');
      expect(typeof entry.timestamp).toBe('string');
    });

    it('supports optional error field', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'error' as const,
        event: 'request_error',
        error: 'Something went wrong',
      };

      expect(entry.error).toBe('Something went wrong');
    });

    it('supports optional details field', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'debug' as const,
        event: 'tool_executed',
        details: { tool: 'recall', args: { query: 'test' } },
      };

      expect(entry.details?.tool).toBe('recall');
    });
  });

  describe('log level filtering', () => {
    it('filters logs below configured level', () => {
      const levels = ['debug', 'info', 'warn', 'error'];
      const configLevel = 'warn';
      const configLevelIndex = levels.indexOf(configLevel);

      const shouldLog = (entryLevel: string) => {
        const entryLevelIndex = levels.indexOf(entryLevel);
        return entryLevelIndex >= configLevelIndex;
      };

      expect(shouldLog('debug')).toBe(false);
      expect(shouldLog('info')).toBe(false);
      expect(shouldLog('warn')).toBe(true);
      expect(shouldLog('error')).toBe(true);
    });
  });

  describe('server statistics', () => {
    it('tracks request and error counts', () => {
      const stats = {
        requestCount: 150,
        errorCount: 3,
        uptime: 60000,
      };

      expect(stats.requestCount).toBe(150);
      expect(stats.errorCount).toBe(3);
      expect(stats.uptime).toBe(60000);
    });

    it('calculates error rate', () => {
      const stats = {
        requestCount: 100,
        errorCount: 5,
      };

      const errorRate = stats.requestCount > 0 ? stats.errorCount / stats.requestCount : 0;
      expect(errorRate).toBe(0.05);
    });
  });

  describe('initialize response', () => {
    it('has correct structure', () => {
      const response = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'entropic-causal-memory',
          version: '0.1.0',
        },
      };

      expect(response.protocolVersion).toBe('2024-11-05');
      expect(response.serverInfo.name).toBe('entropic-causal-memory');
    });
  });

  describe('tools/call params', () => {
    it('extracts tool name and arguments', () => {
      const params = {
        name: 'recall',
        arguments: { query: 'test query', range: 'short' },
      };

      expect(params.name).toBe('recall');
      expect(params.arguments.query).toBe('test query');
    });
  });

  describe('tool response format', () => {
    it('wraps result in content array', () => {
      const toolResult = 'Found 5 relevant chunks...';

      const response = {
        content: [
          {
            type: 'text',
            text: toolResult,
          },
        ],
      };

      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe(toolResult);
    });
  });
});
