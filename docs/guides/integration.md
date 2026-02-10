# Integration Guide

This guide covers integrating Causantic with Claude Code through hooks and MCP.

## Hook System

Causantic uses Claude Code hooks to capture context at key moments:

### session-start

Fires when a new Claude Code session begins.

**Actions:**
1. Query memory for relevant context
2. Generate a memory summary
3. Update CLAUDE.md with relevant memories

**Configuration:**
```json
{
  "hooks": {
    "session-start": {
      "command": "npx causantic hook session-start"
    }
  }
}
```

### pre-compact

Fires before Claude Code compacts the conversation history.

**Actions:**
1. Ingest current session content
2. Create chunks and edges
3. Generate embeddings
4. Preserve context that would be lost

**Configuration:**
```json
{
  "hooks": {
    "pre-compact": {
      "command": "npx causantic hook pre-compact"
    }
  }
}
```

## MCP Server

The MCP server exposes memory tools to Claude:

### Starting the Server

```bash
npx causantic serve
```

### Claude Code Configuration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["causantic", "serve"],
      "env": {
        "CAUSANTIC_STORAGE_DB_PATH": "~/.causantic/memory.db"
      }
    }
  }
}
```

### Available Tools

| Tool | Purpose |
|------|---------|
| `recall` | Semantic search with graph traversal |
| `explain` | Long-range historical context |
| `predict` | Proactive suggestions |

See [MCP Tools Reference](../reference/mcp-tools.md) for details.

## CLAUDE.md Integration

Causantic can automatically update your project's CLAUDE.md with a memory section:

```markdown
## Memory Context

Recent topics: authentication flow, error handling, user settings

Related sessions:
- Fixed login timeout issue (2 days ago)
- Implemented OAuth integration (1 week ago)
```

### Enabling Auto-Update

The `claudemd-generator` hook updates CLAUDE.md on session start:

```json
{
  "hooks": {
    "session-start": {
      "command": "npx causantic hook claudemd-generator"
    }
  }
}
```

### Token Budget

Control the memory section size:

```json
{
  "tokens": {
    "claudeMdBudget": 500
  }
}
```

## Best Practices

1. **Initial ingestion**: Run `batch-ingest` on existing sessions first
2. **Regular maintenance**: Schedule maintenance tasks (see [Maintenance](maintenance.md))
3. **Monitor storage**: Check `~/.causantic/` size periodically
4. **Tune thresholds**: Adjust decay and clustering based on your workflow

## Troubleshooting

- **MCP server not responding**: Check `npx causantic health`
- **Empty memory**: Verify sessions were ingested
- **Slow queries**: Run maintenance to prune stale edges

See [Troubleshooting](troubleshooting.md) for more solutions.
