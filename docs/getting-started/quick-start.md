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

## Step 3: Test the Integration

`npx causantic init` (Step 1) already configured MCP for you. Restart Claude Code and try:

```
You: What did we work on last week in the auth module?
Claude: [Uses memory tools to recall relevant context]
```

## What's Happening

1. **Hooks** capture context at session start and before compaction
2. **Ingestion** parses sessions into semantic chunks
3. **Hybrid retrieval** combines keyword search (BM25) with vector similarity via RRF — no upfront embedding required
4. **Graph** tracks causal relationships between chunks
5. **MCP Tools** let Claude query the memory

## Next Steps

- [Configuration](configuration.md) - Customize clustering, chain walking, token budgets, etc.
- [How It Works](../guides/how-it-works.md) - Understand the architecture
- [MCP Tools](../reference/mcp-tools.md) - Learn about search, recall, and predict
