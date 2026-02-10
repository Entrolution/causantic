# MCP Tools Reference

Reference documentation for Causantic's MCP server tools.

## Starting the Server

```bash
npx causantic serve
```

The server communicates via stdio using the Model Context Protocol (JSON-RPC 2.0).

## Available Tools

All tools return plain text responses via the MCP `content` array with `type: "text"`.

### recall

Retrieve relevant context from memory based on a query. Uses hybrid BM25 + vector search with RRF fusion, cluster expansion, and graph traversal.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | What to look up in memory. Be specific about what context you need. |
| `range` | `string` | No | Time range hint: `"short"` for recent context (last few turns), `"long"` for historical/cross-session context. Default: `"short"`. |
| `project` | `string` | No | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Returns a header with chunk count and token count, followed by the assembled context text. Returns `"No relevant memory found."` if no matches.

**Example**:
```
Found 5 relevant memory chunks (1200 tokens):

[assembled context text...]
```

### explain

Get an explanation of the context and history behind a topic. Defaults to long-range retrieval for comprehensive historical background spanning multiple sessions.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `topic` | `string` | Yes | What topic or aspect to explain. E.g., "the authentication system" or "why we chose React". |
| `range` | `string` | No | Time range: `"short"` for recent context, `"long"` for full history. Default: `"long"`. |
| `project` | `string` | No | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Same format as `recall`. Returns `"No relevant memory found."` if no matches.

### predict

Predict what context or topics might be relevant based on current discussion. Use proactively to surface potentially useful past context.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `context` | `string` | Yes | Current context or topic being discussed. |
| `project` | `string` | No | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Returns `"Potentially relevant context (N items):"` followed by assembled text, or `"No predictions available based on current context."` if no matches. Uses half the token budget of recall/explain.

### list-projects

List all projects in memory with chunk counts and date ranges. Use to discover available project names for filtering other tools.

**Parameters**: None.

**Response**: Plain text list of projects with metadata.

**Example**:
```
Projects in memory:
- my-app (142 chunks, Jan 2025 – Feb 2025)
- api-server (87 chunks, Dec 2024 – Feb 2025)
```

Returns `"No projects found in memory."` if empty.

### list-sessions

List sessions for a project with chunk counts, time ranges, and token totals. Use to browse available sessions before reconstructing context.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project` | `string` | Yes | Project slug. Use `list-projects` to discover available projects. |
| `from` | `string` | No | Start date filter (ISO 8601). |
| `to` | `string` | No | End date filter (ISO 8601). |
| `days_back` | `number` | No | Look back N days from now. Alternative to `from`/`to`. |

**Response**: Plain text list of sessions with abbreviated IDs, timestamps, chunk counts, and token totals.

**Example**:
```
Sessions for "my-app" (3 total):
- a1b2c3d4 (Feb 8, 2:30 PM – 4:15 PM, 12 chunks, 3400 tokens)
- e5f6g7h8 (Feb 7, 10:00 AM – 11:45 AM, 8 chunks, 2100 tokens)
- i9j0k1l2 (Feb 6, 3:00 PM – 5:30 PM, 15 chunks, 4200 tokens)
```

Returns `"No sessions found for project "[name]"."` if none match.

### reconstruct

Rebuild session context for a project by time range. Returns chronological chunks with session boundary markers. Use for questions like "what did I work on yesterday?" or "show me the last session".

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project` | `string` | Yes | Project slug. Use `list-projects` to discover available projects. |
| `session_id` | `string` | No | Specific session ID to reconstruct. |
| `from` | `string` | No | Start date (ISO 8601). |
| `to` | `string` | No | End date (ISO 8601). |
| `days_back` | `number` | No | Look back N days from now. |
| `previous_session` | `boolean` | No | Get the session before the current one. |
| `current_session_id` | `string` | No | Current session ID (required when `previous_session` is true). |
| `keep_newest` | `boolean` | No | Keep newest chunks when truncating to fit token budget. Default: `true`. |

**Response**: Plain text with chronological session context, including session boundary markers and chunk content. Token budget controlled by `tokens.mcpMaxResponse` config.

## Tool Selection Guidelines

| Scenario | Recommended Tool |
|----------|-----------------|
| Quick fact lookup or recent context | `recall` |
| Understanding design evolution or past decisions | `explain` |
| Proactively surfacing relevant past context | `predict` |
| Discovering what projects exist in memory | `list-projects` |
| Browsing sessions before diving into one | `list-sessions` |
| "What did I work on yesterday/last session?" | `reconstruct` |
| Rebuilding context after a compaction | `reconstruct` |

## Token Limits

Response sizes are controlled by `tokens.mcpMaxResponse` in the configuration (default: 2000 tokens). The `predict` tool uses half this budget. Long responses are truncated to fit within the budget.

## Error Handling

Tool errors are returned as MCP JSON-RPC error responses with code `-32002` (tool error) and include the tool name and error message. The `reconstruct` tool catches errors internally and returns them as plain text prefixed with `"Error: "`.
