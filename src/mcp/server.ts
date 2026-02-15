/**
 * MCP (Model Context Protocol) server for memory tools.
 * Provides recall, explain, and predict tools for Claude Code integration.
 *
 * Features:
 * - Health check endpoint (ping)
 * - Structured JSON logging
 * - Graceful shutdown handling
 * - Standardized error responses
 * - Optional token-based authentication
 */

import { createInterface } from 'readline';
import { tools, getTool } from './tools.js';
import { getDb, closeDb } from '../storage/db.js';
import { disposeRetrieval } from '../retrieval/context-assembler.js';
import { getChunkCount } from '../storage/chunk-store.js';
import { getEdgeCount } from '../storage/edge-store.js';
import { getClusterCount } from '../storage/cluster-store.js';
import { createLogger } from '../utils/logger.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const log = createLogger('mcp-server');

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
const VERSION: string = pkg.version;

/** MCP Server configuration */
export interface McpServerConfig {
  /** Enable structured JSON logging */
  enableLogging?: boolean;
  /** Log level: 'debug' | 'info' | 'warn' | 'error' */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Authentication token (if set, requires Authorization header) */
  authToken?: string;
  /** Enable health check endpoint */
  enableHealthCheck?: boolean;
}

/** Log entry structure */
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  requestId?: string | number;
  method?: string;
  durationMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/** Standard error codes */
const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  TOOL_ERROR: -32002,
} as const;

/**
 * MCP request message.
 */
interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP response message.
 */
interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Health check response.
 */
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: {
    database: boolean;
    vectorStore: boolean;
  };
  stats: {
    chunks: number;
    edges: number;
    clusters: number;
  };
}

/**
 * Create a standardized error response.
 */
function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown,
): McpResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Handle MCP requests via JSON-RPC over stdio.
 */
export class McpServer {
  private running = false;
  private startTime = 0;
  private config: Required<McpServerConfig>;
  private requestCount = 0;
  private errorCount = 0;

  constructor(config: McpServerConfig = {}) {
    this.config = {
      enableLogging: config.enableLogging ?? process.env.CAUSANTIC_MCP_LOGGING === 'true',
      logLevel:
        config.logLevel ??
        (process.env.CAUSANTIC_MCP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ??
        'info',
      authToken: config.authToken ?? process.env.CAUSANTIC_MCP_AUTH_TOKEN ?? '',
      enableHealthCheck: config.enableHealthCheck ?? true,
    };
  }

  /**
   * Log a structured message.
   */
  private log(entry: Omit<LogEntry, 'timestamp'>): void {
    if (!this.config.enableLogging) return;

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const entryLevel = levels.indexOf(entry.level);

    if (entryLevel < configLevel) return;

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Write to stderr to avoid interfering with stdio protocol
    process.stderr.write(JSON.stringify(logEntry) + '\n');
  }

  /**
   * Start the MCP server.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // Initialize database
    getDb();

    this.log({ level: 'info', event: 'server_started' });

    // Set up graceful shutdown handlers
    this.setupShutdownHandlers();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const startTime = Date.now();
      this.requestCount++;

      try {
        const request = JSON.parse(line) as McpRequest;

        this.log({
          level: 'debug',
          event: 'request_received',
          requestId: request.id,
          method: request.method,
        });

        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));

        this.log({
          level: 'debug',
          event: 'request_completed',
          requestId: request.id,
          method: request.method,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        this.errorCount++;
        const errorResponse = createErrorResponse(
          0,
          ErrorCodes.PARSE_ERROR,
          'Parse error',
          error instanceof Error ? error.message : String(error),
        );
        console.log(JSON.stringify(errorResponse));

        this.log({
          level: 'error',
          event: 'parse_error',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        });
      }
    });

    rl.on('close', () => {
      this.log({ level: 'info', event: 'stdin_closed' });
      this.stop();
    });
  }

  /**
   * Set up graceful shutdown signal handlers.
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      this.log({ level: 'info', event: 'shutdown_signal', details: { signal } });
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));
  }

  /**
   * Stop the MCP server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.log({
      level: 'info',
      event: 'server_stopping',
      details: {
        uptime: Date.now() - this.startTime,
        requestCount: this.requestCount,
        errorCount: this.errorCount,
      },
    });

    try {
      await disposeRetrieval();
      closeDb();
      this.log({ level: 'info', event: 'server_stopped' });
    } catch (error) {
      this.log({
        level: 'error',
        event: 'shutdown_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check authentication if configured.
   */
  private checkAuth(params?: Record<string, unknown>): boolean {
    if (!this.config.authToken) return true;

    const token = params?._auth as string | undefined;
    return token === this.config.authToken;
  }

  /**
   * Handle a single MCP request.
   */
  private async handleRequest(request: McpRequest): Promise<McpResponse> {
    const { id, method, params } = request;

    // Check authentication for non-system methods
    if (method !== 'initialize' && !this.checkAuth(params)) {
      this.log({ level: 'warn', event: 'auth_failed', requestId: id, method });
      return createErrorResponse(id, ErrorCodes.UNAUTHORIZED, 'Unauthorized');
    }

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          return await this.handleToolsCall(
            id,
            params as { name: string; arguments: Record<string, unknown> },
          );

        case 'ping':
          return this.handlePing(id);

        case 'health':
          return await this.handleHealth(id);

        case 'shutdown':
          await this.stop();
          return { jsonrpc: '2.0', id, result: null };

        default:
          return createErrorResponse(
            id,
            ErrorCodes.METHOD_NOT_FOUND,
            `Method not found: ${method}`,
          );
      }
    } catch (error) {
      this.errorCount++;
      this.log({
        level: 'error',
        event: 'request_error',
        requestId: id,
        method,
        error: error instanceof Error ? error.message : String(error),
      });

      return createErrorResponse(
        id,
        ErrorCodes.INTERNAL_ERROR,
        'Internal error',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Handle ping request (simple health check).
   */
  private handlePing(id: string | number): McpResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: { pong: true, timestamp: Date.now() },
    };
  }

  /**
   * Handle detailed health check request.
   */
  private async handleHealth(id: string | number): Promise<McpResponse> {
    if (!this.config.enableHealthCheck) {
      return createErrorResponse(id, ErrorCodes.METHOD_NOT_FOUND, 'Health check disabled');
    }

    let dbOk = false;
    let vectorOk = false;
    let chunks = 0;
    let edges = 0;
    let clusters = 0;

    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      dbOk = true;
      chunks = getChunkCount();
      edges = getEdgeCount();
      clusters = getClusterCount();
    } catch {
      dbOk = false;
    }

    try {
      // Vector store health check
      const { vectorStore } = await import('../storage/vector-store.js');
      if (vectorStore) {
        vectorOk = true;
      }
    } catch {
      vectorOk = false;
    }

    const status: HealthStatus = {
      status: dbOk && vectorOk ? 'healthy' : dbOk ? 'degraded' : 'unhealthy',
      version: VERSION,
      uptime: Date.now() - this.startTime,
      checks: {
        database: dbOk,
        vectorStore: vectorOk,
      },
      stats: {
        chunks,
        edges,
        clusters,
      },
    };

    return {
      jsonrpc: '2.0',
      id,
      result: status,
    };
  }

  /**
   * Handle initialize request.
   */
  private handleInitialize(id: string | number): McpResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'causantic',
          version: VERSION,
        },
      },
    };
  }

  /**
   * Handle tools/list request.
   */
  private handleToolsList(id: string | number): McpResponse {
    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id,
      result: { tools: toolList },
    };
  }

  /**
   * Handle tools/call request.
   */
  private async handleToolsCall(
    id: string | number,
    params: { name: string; arguments: Record<string, unknown> },
  ): Promise<McpResponse> {
    const { name, arguments: args } = params;

    const tool = getTool(name);
    if (!tool) {
      return createErrorResponse(id, ErrorCodes.INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    const startTime = Date.now();

    try {
      const result = await tool.handler(args);

      this.log({
        level: 'info',
        event: 'tool_executed',
        requestId: id,
        details: { tool: name, durationMs: Date.now() - startTime },
      });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        },
      };
    } catch (error) {
      this.log({
        level: 'error',
        event: 'tool_error',
        requestId: id,
        details: { tool: name },
        error: error instanceof Error ? error.message : String(error),
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(
        id,
        ErrorCodes.TOOL_ERROR,
        `Tool '${name}' failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Get server statistics.
   */
  getStats(): { requestCount: number; errorCount: number; uptime: number } {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      uptime: Date.now() - this.startTime,
    };
  }
}

/**
 * Create and start the MCP server.
 */
export async function startMcpServer(config?: McpServerConfig): Promise<McpServer> {
  const server = new McpServer(config);
  await server.start();
  return server;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((error) => {
    log.error('Failed to start MCP server:', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
