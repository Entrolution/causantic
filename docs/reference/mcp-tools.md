# MCP Tools Reference

Reference documentation for Causantic's MCP server tools.

## Starting the Server

```bash
npx causantic serve
```

The server communicates via stdio using the Model Context Protocol (JSON-RPC 2.0).

## Available Tools

All tools return plain text responses via the MCP `content` array with `type: "text"`.

### search

Search memory semantically to discover relevant past context. Returns ranked results by relevance using hybrid BM25 + vector search with RRF fusion and cluster expansion.

**Parameters**:

| Name      | Type     | Required | Description                                                                                      |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `query`   | `string` | Yes      | What to search for in memory. Be specific about what context you need.                           |
| `project` | `string` | No       | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Returns a header with chunk count and token count, followed by the assembled context text. Returns `"No relevant memory found."` if no matches.

**Example**:

```
Found 5 relevant memory chunks (1200 tokens):

[assembled context text...]
```

### recall

Recall episodic memory by walking backward through causal chains to reconstruct narrative context. Seeds are found by semantic search; the causal graph unfolds them into ordered chains; chains are ranked by aggregate semantic relevance per token. Falls back to search results when no viable chain is found.

**Parameters**:

| Name      | Type     | Required | Description                                                                                      |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `query`   | `string` | Yes      | What to recall from memory. Be specific about what context you need.                             |
| `project` | `string` | No       | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Returns an ordered narrative (problem → solution). When the chain walker falls back to search, a diagnostic bracket is appended with details about what was attempted.

**Example** (successful chain walk):

```
Found 4 relevant memory chunks (900 tokens):

[ordered narrative context...]
```

**Example** (fallback with diagnostics):

```
Found 3 relevant memory chunks (650 tokens):

[search-based context...]

[Chain walk: fell back to search — No edges found from seed chunks. Search found 5 chunks, 3 seeds, 0 chain(s) attempted, lengths: none]
```

### predict

Predict what context or topics might be relevant based on current discussion. Walks forward through causal chains to surface likely next steps. Falls back to search results when no viable chain is found.

**Parameters**:

| Name      | Type     | Required | Description                                                                                      |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `context` | `string` | Yes      | Current context or topic being discussed.                                                        |
| `project` | `string` | No       | Filter to a specific project. Omit to search all. Use `list-projects` to see available projects. |

**Response**: Plain text. Returns `"Potentially relevant context (N items):"` followed by assembled text, or `"No predictions available based on current context."` if no matches. Uses half the token budget of recall/search. Includes chain walk diagnostics when falling back to search.

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

| Name        | Type     | Required | Description                                                       |
| ----------- | -------- | -------- | ----------------------------------------------------------------- |
| `project`   | `string` | Yes      | Project slug. Use `list-projects` to discover available projects. |
| `from`      | `string` | No       | Start date filter (ISO 8601).                                     |
| `to`        | `string` | No       | End date filter (ISO 8601).                                       |
| `days_back` | `number` | No       | Look back N days from now. Alternative to `from`/`to`.            |

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

| Name                 | Type      | Required | Description                                                              |
| -------------------- | --------- | -------- | ------------------------------------------------------------------------ |
| `project`            | `string`  | Yes      | Project slug. Use `list-projects` to discover available projects.        |
| `session_id`         | `string`  | No       | Specific session ID to reconstruct.                                      |
| `from`               | `string`  | No       | Start date (ISO 8601).                                                   |
| `to`                 | `string`  | No       | End date (ISO 8601).                                                     |
| `days_back`          | `number`  | No       | Look back N days from now.                                               |
| `previous_session`   | `boolean` | No       | Get the session before the current one.                                  |
| `current_session_id` | `string`  | No       | Current session ID (required when `previous_session` is true).           |
| `keep_newest`        | `boolean` | No       | Keep newest chunks when truncating to fit token budget. Default: `true`. |

**Response**: Plain text with chronological session context, including session boundary markers and chunk content. Token budget controlled by `tokens.mcpMaxResponse` config.

### hook-status

Check when Causantic hooks last ran and whether they succeeded. Use for diagnosing whether hooks are firing correctly after setup or configuration changes.

**Parameters**: None.

**Response**: Plain text report showing last run time and status for each hook (session-start, session-end, pre-compact, claudemd-generator).

### stats

Show memory statistics including version, chunk/edge/cluster counts, and per-project breakdowns. Use to check system health and memory usage.

**Parameters**: None.

**Response**: Formatted text with version, aggregate counts, and per-project details.

**Example**:

```
Causantic v0.4.2

Memory Statistics:
- Chunks: 1234
- Edges: 5678
- Clusters: 42

Projects:
- my-app: 800 chunks (Jan 2025 – Feb 2025)
- api-server: 434 chunks (Dec 2024 – Feb 2025)
```

### forget

Delete chunks from memory filtered by project, time range, session, or semantic query. Requires `project` to prevent accidental full-database deletion. Defaults to `dry_run=true` (preview only).

**Parameters**:

| Name         | Type      | Required | Description                                                                                                                                                                      |
| ------------ | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`    | `string`  | Yes      | Project slug. Use `list-projects` to see available projects.                                                                                                                     |
| `before`     | `string`  | No       | Delete chunks before this ISO 8601 date.                                                                                                                                         |
| `after`      | `string`  | No       | Delete chunks on or after this ISO 8601 date.                                                                                                                                    |
| `session_id` | `string`  | No       | Delete chunks from a specific session.                                                                                                                                           |
| `query`      | `string`  | No       | Semantic query for topic-based deletion (e.g., "authentication flow"). Finds similar chunks by embedding similarity. Can combine with `before`/`after`/`session_id` (AND logic). |
| `threshold`  | `number`  | No       | Similarity threshold (0–1 or 0–100, default 0.6). Higher = more selective. Values >1 treated as percentages (e.g., `60` → `0.6`). Only used when `query` is provided.            |
| `dry_run`    | `boolean` | No       | Preview without deleting (default: `true`). Set to `false` to actually delete.                                                                                                   |

**Response**: In dry-run mode without `query`, returns the count of chunks that would be deleted. With `query`, dry-run shows top matches with similarity scores, score distribution (min/max/median), and content previews. When `dry_run=false`, deletes the chunks along with their edges, cluster assignments, FTS entries (via CASCADE), and vector embeddings.

**Example** (filter-based dry run):

```
Dry run: 47 chunk(s) would be deleted from project "my-app". Set dry_run=false to proceed.
```

**Example** (semantic dry run):

```
Dry run: 12 chunk(s) match query "authentication flow" (threshold: 60%, project: "my-app")
Scores: 94% max, 63% min, 78% median

Top matches:
  1. [94%] "We implemented JWT authentication with refresh tokens..." (Jan 15, 2025)
  2. [87%] "The auth middleware validates tokens on each request..." (Jan 15, 2025)
  3. [72%] "Fixed the token expiry bug in the auth module..." (Jan 20, 2025)
  4. [68%] "Added CSRF protection to the login form..." (Jan 22, 2025)
  5. [63%] "Token refresh endpoint now returns new expiry..." (Jan 25, 2025)
  ...and 7 more
Set dry_run=false to proceed with deletion.
```

**Example** (actual deletion):

```
Deleted 47 chunk(s) from project "my-app" (vectors and related edges/clusters also removed).
```

Returns `"No chunks match the given filters."` if no chunks match (filter-based), or `'No chunks match query "X" at threshold Y%'` for semantic queries with no results.

## Tool Selection Guidelines

| Scenario                                        | Recommended Tool                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Broad discovery — "what do I know about X?"     | `search`                                                             |
| Episodic narrative — "how did we solve X?"      | `recall`                                                             |
| Proactively surfacing relevant past context     | `predict`                                                            |
| Discovering what projects exist in memory       | `list-projects`                                                      |
| Browsing sessions before diving into one        | `list-sessions`                                                      |
| "What did I work on yesterday/last session?"    | `reconstruct`                                                        |
| Checking system health and memory usage         | `stats`                                                              |
| Diagnosing hook issues                          | `hook-status`                                                        |
| Deleting old or unwanted memory by time/session | `forget` (with `before`/`after`/`session_id`) or `/causantic-forget` |
| Deleting memory about a topic                   | `forget` (with `query`) or `/causantic-forget`                       |

## Chain Walk Diagnostics

The `recall` and `predict` tools use episodic chain walking — following directed edges through the causal graph to build ordered narratives. When the chain walker cannot find a viable chain, it falls back to search results and appends a diagnostic bracket explaining why:

| Diagnostic Reason                                      | Meaning                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `No matching chunks in memory`                         | Search found 0 results — memory is empty or the query has no matches |
| `Search found chunks but none suitable as chain seeds` | Search returned results but none could seed a chain walk             |
| `No edges found from seed chunks`                      | Seed chunks have no outgoing edges in the causal graph               |
| `All chains had only 1 chunk (minimum 2 required)`     | Edges exist but every chain was too short                            |
| `No chain met the qualifying threshold`                | Chains were attempted but none scored well enough                    |

These diagnostics help distinguish between "memory is empty" and "memory exists but lacks graph structure for episodic retrieval."

## Token Limits

Response sizes are controlled by `tokens.mcpMaxResponse` in the configuration (default: 2000 tokens). The `predict` tool uses half this budget. Long responses are truncated to fit within the budget.

## Error Handling

Tool errors are returned as MCP JSON-RPC error responses with code `-32002` (tool error) and include the tool name and actual error message. The `reconstruct` tool catches errors internally and returns them as plain text prefixed with `"Error: "`.
