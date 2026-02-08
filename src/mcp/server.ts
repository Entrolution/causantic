/**
 * MCP (Model Context Protocol) server for memory tools.
 * Provides recall, explain, and predict tools for Claude Code integration.
 *
 * Note: This is a simplified MCP server implementation.
 * For production use, consider using the official MCP SDK.
 */

import { createInterface } from 'readline';
import { tools, getTool } from './tools.js';
import { getDb, closeDb } from '../storage/db.js';
import { disposeRetrieval } from '../retrieval/context-assembler.js';
import { initStartupPrune } from '../storage/pruner.js';

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
 * Handle MCP requests via JSON-RPC over stdio.
 */
export class McpServer {
  private running = false;

  /**
   * Start the MCP server.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize database
    getDb();

    // Start background pruning (non-blocking)
    initStartupPrune();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      try {
        const request = JSON.parse(line) as McpRequest;
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        const errorResponse: McpResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32700,
            message: 'Parse error',
            data: error instanceof Error ? error.message : String(error),
          },
        };
        console.log(JSON.stringify(errorResponse));
      }
    });

    rl.on('close', () => {
      this.stop();
    });
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    await disposeRetrieval();
    closeDb();
  }

  /**
   * Handle a single MCP request.
   */
  private async handleRequest(request: McpRequest): Promise<McpResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          return await this.handleToolsCall(id, params as { name: string; arguments: Record<string, unknown> });

        case 'shutdown':
          await this.stop();
          return { jsonrpc: '2.0', id, result: null };

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
      };
    }
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
          name: 'semansiation-memory',
          version: '0.1.0',
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
    params: { name: string; arguments: Record<string, unknown> }
  ): Promise<McpResponse> {
    const { name, arguments: args } = params;

    const tool = getTool(name);
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Unknown tool: ${name}`,
        },
      };
    }

    try {
      const result = await tool.handler(args);
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
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Tool execution failed',
          data: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

/**
 * Create and start the MCP server.
 */
export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer();
  await server.start();
  return server;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}
