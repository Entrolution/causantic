/**
 * CLI script to start the MCP server.
 * Usage: npm run mcp-server
 */

import { startMcpServer } from '../src/mcp/server.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.error(`
MCP Memory Server

Provides memory tools (recall, explain, predict) via Model Context Protocol.

Usage: npm run mcp-server

This server communicates via JSON-RPC over stdio.
Configure it in your Claude Code settings to enable memory tools.

Settings example (.claude/settings.json):
{
  "mcpServers": {
    "memory": {
      "command": "npm",
      "args": ["run", "mcp-server"],
      "cwd": "/path/to/causantic"
    }
  }
}
    `);
    process.exit(0);
  }

  // Start server (this blocks until stdin closes)
  await startMcpServer();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
