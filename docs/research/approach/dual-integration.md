# Dual Integration: Hooks + MCP

This document explains why Causantic uses both hooks and MCP for Claude Code integration.

## Two Integration Points

Causantic integrates with Claude Code through two mechanisms:

1. **Hooks**: Automatic lifecycle events
2. **MCP**: On-demand tool calls

## Hook System

Hooks fire automatically at key moments:

### session-start

**Trigger**: New Claude Code session begins

**Actions**:

- Query recent relevant context
- Generate memory summary
- Update CLAUDE.md

**Purpose**: Prime Claude with relevant historical context before the conversation starts.

### pre-compact

**Trigger**: Before conversation history is compressed

**Actions**:

- Ingest current session content
- Create chunks and edges
- Generate embeddings

**Purpose**: Preserve context that would otherwise be lost during compaction.

## MCP Server

MCP provides on-demand access during the conversation:

### recall

**Usage**: "What did we do about X?"

Claude actively queries memory when the user asks about historical context.

### explain

**Usage**: Understanding complex historical background

Claude retrieves comprehensive context spanning multiple sessions.

### predict

**Usage**: Proactive context surfacing

Claude identifies relevant historical context without being asked.

## Why Both?

| Capability            | Hooks | MCP     |
| --------------------- | ----- | ------- |
| Automatic capture     | Yes   | No      |
| On-demand queries     | No    | Yes     |
| Background operation  | Yes   | No      |
| Interactive           | No    | Yes     |
| Context priming       | Yes   | Partial |
| User-initiated recall | No    | Yes     |

### Hooks Excel At

- **Capture**: Reliably recording session content
- **Priming**: Setting up context before conversation
- **Maintenance**: Regular updates (CLAUDE.md)

### MCP Excels At

- **Queries**: Complex, specific retrievals
- **Interactivity**: Responding to user questions
- **Flexibility**: Different query types (recall vs explain vs predict)

## Data Flow

```
Session Start
     │
     ├─── Hook: session-start
     │         └─── Update CLAUDE.md with memory context
     │
     ▼
Conversation
     │
     ├─── MCP: recall, explain, predict
     │         └─── On-demand historical context
     │
     ▼
Session End / Compaction
     │
     └─── Hook: pre-compact
               └─── Ingest and preserve context
```

## Configuration

Both systems share the same configuration and storage:

```json
{
  "tokens": {
    "claudeMdBudget": 500,
    "mcpMaxResponse": 2000
  }
}
```

Hooks use `claudeMdBudget` for CLAUDE.md updates.
MCP uses `mcpMaxResponse` for tool responses.

## Best Practices

1. **Enable both**: They serve complementary purposes
2. **Tune token budgets**: Balance context richness with response size
3. **Monitor hooks**: Ensure they're firing reliably
4. **Train Claude**: Let Claude know memory tools are available
