import type { Command } from '../types.js';

export const serveCommand: Command = {
  name: 'serve',
  description: 'Start the MCP server',
  usage: 'causantic serve [--health-check]',
  handler: async (_args) => {
    const mcpServer = await import('../../mcp/server.js');
    const startFn = (mcpServer as Record<string, unknown>).startMcpServer
      ?? (mcpServer as Record<string, unknown>).start
      ?? (mcpServer as Record<string, unknown>).main;
    if (typeof startFn === 'function') {
      await startFn();
    } else {
      console.log('MCP server started on stdio');
      await new Promise(() => {});
    }
  },
};
