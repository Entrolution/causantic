# Quick Start

Get Causantic up and running with Claude Code in 5 minutes.

## Step 1: Install Causantic

```bash
npm install causantic
npx causantic init
```

## Step 2: Ingest Your Sessions

Causantic needs to analyze your existing Claude Code sessions to build its memory:

```bash
# Ingest all sessions from your Claude Code projects
npx causantic batch-ingest ~/.claude/projects
```

This creates:

- A SQLite database at `~/.causantic/memory.db`
- A vector store at `~/.causantic/vectors/`

## Step 3: Configure Claude Code

Add Causantic as an MCP server in your Claude Code configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["causantic", "serve"]
    }
  }
}
```

## Step 4: Test the Integration

Restart Claude Code and try:

```
You: What did we work on last week in the auth module?
Claude: [Uses memory tools to recall relevant context]
```

## What's Happening

1. **Hooks** capture context at session start and before compaction
2. **Ingestion** parses sessions into semantic chunks
3. **Embeddings** enable similarity search
4. **Graph** tracks causal relationships between chunks
5. **MCP Tools** let Claude query the memory

## Next Steps

- [Configuration](configuration.md) - Customize decay curves, thresholds, etc.
- [How It Works](../guides/how-it-works.md) - Understand the architecture
- [MCP Tools](../reference/mcp-tools.md) - Learn about search, recall, and predict
