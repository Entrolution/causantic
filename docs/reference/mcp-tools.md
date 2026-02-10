# MCP Tools Reference

Reference documentation for ECM's MCP server tools.

## Starting the Server

```bash
npx ecm serve
```

The server communicates via stdio using the Model Context Protocol.

## Available Tools

### recall

Hybrid BM25 + vector search with graph-augmented retrieval.

**Purpose**: Find relevant historical context based on a query. Uses parallel vector and keyword search, fused via RRF, with cluster expansion and graph traversal.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | The search query |
| `limit` | `integer` | No | Maximum results (default: 10) |
| `minScore` | `number` | No | Minimum similarity score (default: 0.5) |

**Response**:

```json
{
  "results": [
    {
      "chunkId": "abc123",
      "content": "Discussion about authentication flow...",
      "score": 0.87,
      "session": "project-a-2024-02-01",
      "cluster": "Authentication"
    }
  ],
  "graphContext": [
    {
      "chunkId": "def456",
      "content": "Related OAuth implementation...",
      "relation": "backward",
      "hops": 2
    }
  ]
}
```

**Example usage by Claude**:

```
Claude uses recall to find context about "how did we implement rate limiting"
```

### explain

Long-range historical context for complex questions.

**Purpose**: Provide comprehensive historical background spanning multiple sessions.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `topic` | `string` | Yes | The topic to explain |
| `depth` | `integer` | No | Traversal depth (default: 20) |
| `includeTimeline` | `boolean` | No | Include chronological timeline (default: true) |

**Response**:

```json
{
  "summary": "The authentication system was implemented in phases...",
  "timeline": [
    {
      "date": "2024-01-15",
      "session": "project-a",
      "event": "Initial OAuth setup"
    },
    {
      "date": "2024-01-20",
      "session": "project-a",
      "event": "Added token refresh logic"
    }
  ],
  "relatedClusters": ["Authentication", "Security", "API Design"],
  "keyChunks": [...]
}
```

**Example usage by Claude**:

```
Claude uses explain to understand "the evolution of our error handling approach"
```

### predict

Proactive suggestions based on current context.

**Purpose**: Suggest relevant historical context before being asked.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `context` | `string` | Yes | Current conversation context |
| `limit` | `integer` | No | Maximum suggestions (default: 5) |

**Response**:

```json
{
  "suggestions": [
    {
      "title": "Previous login timeout fix",
      "relevance": 0.92,
      "summary": "Last week we fixed a similar timeout issue...",
      "chunkId": "xyz789"
    }
  ]
}
```

**Example usage by Claude**:

```
Claude uses predict with current context to proactively surface relevant memories
```

## Tool Selection Guidelines

| Scenario | Recommended Tool |
|----------|-----------------|
| User asks about past work | `recall` |
| User needs historical background | `explain` |
| Complex problem similar to past issues | `predict` |
| Quick fact lookup | `recall` |
| Understanding design evolution | `explain` |

## Error Handling

Tools return structured errors:

```json
{
  "error": {
    "code": "NO_RESULTS",
    "message": "No matching chunks found",
    "suggestion": "Try a broader query or check if sessions were ingested"
  }
}
```

Error codes:

| Code | Description |
|------|-------------|
| `NO_RESULTS` | Query returned no matches |
| `DB_ERROR` | Database access error |
| `INVALID_PARAMS` | Invalid parameter values |
| `TIMEOUT` | Query took too long |

## Token Limits

Response sizes are controlled by `tokens.mcpMaxResponse` (default: 2000).

Long responses are truncated with a continuation indicator:

```json
{
  "results": [...],
  "truncated": true,
  "totalCount": 25,
  "returnedCount": 10
}
```
