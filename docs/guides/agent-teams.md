# Agent Teams

Causantic supports Claude Code's multi-agent team sessions, where a lead agent coordinates multiple teammates to work in parallel. This guide explains how team sessions are captured in memory and how to query them.

## What Is Multi-Agent Memory?

In a typical Claude Code session, a single agent works through a conversation with optional sub-agents spawned via the `Task` tool. Multi-agent team sessions are different: a lead agent creates a named team using `TeamCreate`, then dispatches work to multiple teammates via `Task` (with a `team_name` parameter). Teammates communicate with each other using `SendMessage` and report results back to the lead.

Without multi-agent memory support, all of this teammate activity would be lost or flattened into a single stream. Causantic preserves the team structure:

- Each teammate's work is stored as separately attributed chunks
- Causal edges connect the lead to teammates and teammates to each other
- Queries can filter by agent name to focus on one teammate's contributions
- Reconstruction shows agent boundary markers so you can see who did what

This matters when you need to understand what a specific teammate worked on, trace how information flowed between agents, or recall a decision made by one agent without noise from others.

## How Teams Are Detected

Causantic detects team sessions automatically during ingestion. No configuration is needed. Detection works by scanning the main session for three Claude Code tool calls:

| Signal | Tool Call | What It Means |
|--------|-----------|---------------|
| Team creation | `TeamCreate` with `team_name` | A named team was created |
| Teammate spawn | `Task` with `team_name` in input | A teammate was assigned work |
| Inter-agent messaging | `SendMessage` | Agents communicated with each other |

If any of these signals are present, the session is classified as a team session. Regular sub-agent sessions (spawned without `team_name`) continue through the existing brief/debrief pipeline unaffected. Mixed sessions with both team members and regular sub-agents are handled correctly --- each type goes through its own pipeline.

## Agent Name Resolution

Claude Code identifies teammates internally by hex IDs (e.g., `a1b2c3d4`). Causantic resolves these to human-readable names using a priority chain:

1. **Task `name` parameter** (highest priority) --- the name given when spawning the teammate
2. **Task result parsing** --- cross-referencing hex IDs found in tool results with known sub-agent files
3. **SendMessage routing metadata** --- sender information in message exchange results
4. **`<teammate-message>` XML fallback** --- teammate IDs embedded in XML tags within user messages
5. **Fallback naming** --- unresolved agents get sequential names like `teammate-1`, `teammate-2`

In practice, most teammates are resolved via the Task `name` parameter (step 1), since Claude Code sets this when dispatching work.

## File Grouping and Dead-End Filtering

A single teammate can produce multiple sub-agent files. This happens because each incoming message to a teammate creates a new context, which Claude Code stores as a separate JSONL file. Causantic groups these files by resolved human name so that all of a teammate's work is attributed consistently.

Race conditions during team communication can also create stub files --- empty or near-empty files produced when multiple messages arrive simultaneously. Causantic detects and skips these dead-end files using two checks:

- No assistant messages in the first ~10 lines
- Two or fewer non-empty lines in the file

Both conditions must be true for a file to be classified as a dead end.

## Team Edges

Causantic creates three types of causal edges for team sessions, connecting chunks across agent boundaries:

### team-spawn (weight: 0.9)

Created when the lead dispatches work to a teammate. Connects the lead's chunk containing the `Task` call to the teammate's first chunk.

```
Lead chunk (Task call) ──team-spawn──> Teammate's first chunk
```

### team-report (weight: 0.9)

Created when a teammate sends results back to the lead via `SendMessage`. Connects the teammate's chunk containing the `SendMessage` call to the lead's chunk that received the `<teammate-message>`.

```
Teammate chunk (SendMessage) ──team-report──> Lead chunk (received message)
```

### peer-message (weight: 0.85)

Created when one teammate sends a message to another teammate via `SendMessage`. Connects the sender's chunk to the receiver's chunk.

```
Teammate A chunk (SendMessage) ──peer-message──> Teammate B chunk (received message)
```

The slightly lower weight on peer messages (0.85 vs 0.9) reflects that lateral communication between teammates is typically less central to the overall task narrative than lead-teammate coordination.

### Edge Matching

Causantic matches send and receive events across agent files using two strategies:

1. **XML tag matching** (primary): Looks for `<teammate-message teammate_id="name">` tags in user messages that correspond to the sender's `SendMessage` call
2. **Timestamp proximity** (fallback): When XML matching fails, finds the closest chunk within a 10-second window of the send timestamp

A warning is logged when falling back to timestamp proximity, since it is less precise.

## Ingestion Pipeline

Understanding the ingestion pipeline helps when diagnosing issues or interpreting team data. Here is what happens when a team session is ingested:

```
1. Parse main session JSONL
2. Discover sub-agent files in the session's subagents/ directory
3. Classify each sub-agent file (active vs dead-end)
4. Scan main session turns for TeamCreate / Task / SendMessage signals
5. If team signals found:
   a. Resolve hex agent IDs to human-readable names
   b. Partition sub-agents into team members vs regular sub-agents
   c. Process regular sub-agents through the brief/debrief pipeline
   d. Group team member files by resolved name
   e. Process each teammate's files: parse → chunk → embed → store
   f. Set agentId and teamName on each teammate's chunks
   g. Detect team edges (spawn, report, peer-message)
   h. Create edges in the database
6. If no team signals:
   a. Process all sub-agents through the existing brief/debrief pipeline
7. Create cross-session edges to link with previous sessions
```

Steps 5a through 5h are the team-specific additions introduced in v0.7.0. The rest of the pipeline is unchanged from non-team sessions.

The `IngestResult` returned after ingestion includes team-specific fields:

- `isTeamSession` --- whether team signals were detected
- `teamEdges` --- number of team edges created
- `deadEndFilesSkipped` --- number of dead-end stub files filtered out

## Querying by Agent

Four MCP tools accept an optional `agent` parameter for filtering results to a specific teammate:

- `search` --- filters all search results to chunks from that agent
- `recall` --- filters seed selection to that agent; chain walking crosses agent boundaries
- `predict` --- same behavior as recall (seeds filtered, chains cross boundaries)
- `reconstruct` --- filters chunks to that agent in both timeline and time-range modes

### Using the Agent Parameter

Pass the human-readable agent name (not the hex ID):

```
search(query: "authentication implementation", agent: "security-reviewer")
recall(query: "how was the database schema designed?", agent: "db-architect")
reconstruct(project: "my-app", agent: "researcher")
```

When no `agent` parameter is provided, all agents' chunks are included in results.

### How Agent Filtering Works in Practice

For `search`, the filter is applied at every stage: vector search, keyword search, and cluster expansion all respect the agent boundary. Only chunks attributed to the specified agent appear in results.

For `recall` and `predict`, the behavior is intentionally different. The agent filter applies only to **seed selection** --- the initial semantic search that finds starting points for chain walking. Once a chain walk begins, it follows edges freely across agent boundaries. This is by design: a teammate's work often only makes sense in the context of what the lead asked for and what was reported back. A chain that starts at a researcher's chunk might follow a `team-report` edge back to the lead's chunk where the findings were synthesized.

To prevent chains from wandering too far through non-matching agents, the chain walker abandons a branch after 5 consecutive chunks that don't match the agent filter (configurable via `maxSkippedConsecutive`).

For `reconstruct`, the filter is strict --- only chunks from the specified agent appear in the output, with no cross-agent chain walking.

### Agent Attribution in Output

When results include chunks from named agents, Causantic adds attribution automatically.

In **search** and **recall** results, chunk headers include the agent name:

```
[Feb 21, 2026 | Agent: researcher]
Found three relevant patterns in the authentication module...
```

In **reconstruct** output, agent boundary markers appear when the agent changes:

```
--- Agent: researcher ---
Analyzed the authentication module. Found three patterns...

--- Agent: security-reviewer ---
Reviewed the patterns identified by researcher. The token rotation...

--- Agent: researcher ---
Updated implementation based on security review feedback...
```

These markers only appear when a session has multiple agents. Single-agent sessions show no attribution.

## Using Skills with Agent Filtering

The Causantic skills that wrap MCP tools also support agent filtering:

| Skill | Agent Support |
|-------|--------------|
| `/causantic-recall` | Pass agent name in the query argument |
| `/causantic-search` | Pass agent name in the query argument |
| `/causantic-predict` | Pass agent name in the context argument |
| `/causantic-reconstruct` | Mention the agent name when invoking |
| `/causantic-resume` | Automatically shows team session context when present |
| `/causantic-summary` | Includes team session information in recaps |

## Checking Team Statistics

The `stats` MCP tool (or `/causantic-status` skill) reports team-specific metrics when team data exists:

```
Agent Teams:
- Agent chunks: 156
- Distinct agents: 4
- team-spawn edges: 3
- team-report edges: 8
- peer-message edges: 12
```

These numbers tell you:

- **Agent chunks**: How many memory chunks came from named agents (vs. the lead or UI agent)
- **Distinct agents**: How many unique teammate names appear across all sessions
- **Edge counts by type**: The communication pattern --- many `peer-message` edges suggest heavy inter-agent collaboration; mostly `team-spawn` + `team-report` suggests a hub-and-spoke pattern

## Database Schema

Team data is stored in two columns on the `chunks` table:

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | `TEXT` | Human-readable agent name (null for lead/UI agent) |
| `team_name` | `TEXT` | Team name from `TeamCreate` (null for non-team sessions) |

Three composite indexes support efficient agent-scoped queries:

- `idx_chunks_team_name` --- filter by team
- `idx_chunks_agent_start` --- filter by agent with time ordering
- `idx_chunks_team_start` --- filter by team with time ordering

Team edges use the standard `edges` table with `edge_type` set to `team-spawn`, `team-report`, or `peer-message`.

## Practical Examples

### Investigating what a specific teammate worked on

```
search(query: "what did the researcher find?", agent: "researcher", project: "my-app")
```

Returns only chunks attributed to the "researcher" agent, ranked by relevance.

### Tracing the full narrative of a team task

```
recall(query: "database migration planning", project: "my-app")
```

Without an agent filter, recall walks the full causal chain: the lead's initial task dispatch, the researcher's analysis, the architect's schema design, and the lead's synthesis. The chain follows team edges naturally.

### Reconstructing a teammate's timeline

```
reconstruct(project: "my-app", agent: "security-reviewer")
```

Returns only the security reviewer's chunks in chronological order, useful for understanding what that specific agent saw and did.

### Comparing agent contributions

Run two searches with different agent filters:

```
search(query: "error handling approach", agent: "researcher")
search(query: "error handling approach", agent: "implementer")
```

This reveals how different teammates approached the same topic.

### Understanding information flow in a team session

Use `recall` without an agent filter to see the full causal narrative, then narrow down:

```
# Full narrative: lead dispatched → agents worked → results synthesized
recall(query: "API redesign", project: "my-app")

# Just the researcher's perspective
recall(query: "API redesign", agent: "researcher", project: "my-app")

# Just the implementer's perspective
recall(query: "API redesign", agent: "implementer", project: "my-app")
```

The unfiltered recall shows the complete story including team edges. Filtered recalls start from each agent's seeds but may still include cross-agent context via chain walking.

### Checking if a team session was ingested correctly

```
stats()
```

Look at the "Agent Teams" section. If `team-spawn` edges are 0 but you expected a team session, the team signals may not have been detected --- check that the session used `TeamCreate` and `Task` with `team_name`.

### Re-ingesting a session after an upgrade

If you upgraded from a version before v0.7.0 and want team data for existing sessions:

```bash
# Delete old memory for the session, then re-ingest
npx causantic ingest /path/to/session.jsonl
```

The session will be re-parsed with team detection enabled, creating agent-attributed chunks and team edges that were not captured on the original ingestion.

## Multi-Agent Skills

Some Causantic skills are themselves multi-agent workflows. The `/causantic-cleanup` skill spawns four parallel specialist agents (Infrastructure, Design, Documentation, Memory), each with a fresh context window, to review a codebase without exhausting the lead agent's context. After all specialists report back, the lead synthesizes their findings into a prioritised cleanup plan.

When the cleanup session is ingested, each specialist's work appears as agent-attributed chunks connected to the lead via team edges. You can then query memory filtered by specialist:

```
search(query: "dead code findings", agent: "infrastructure")
search(query: "architecture concerns", agent: "design")
```

This is a practical example of how multi-agent memory preserves structure: without it, all four specialists' findings would be mixed together in a single undifferentiated stream.

## Troubleshooting

### Agent filter returns no results

- Verify the agent name matches exactly (case-sensitive). Use `stats` to confirm agents exist in memory.
- The agent name is the human-readable name, not the hex ID. Common names are whatever was passed as the `name` parameter in the `Task` call that spawned the teammate.

### Team edges are missing

- Team edge detection requires both the main session and sub-agent files to be present during ingestion. If sub-agent files were deleted before ingestion, edges cannot be created.
- Check logs for "falling back to timestamp proximity" warnings, which indicate that XML tag matching failed and the system used time-based matching instead.

### Cross-agent contamination in filtered queries

- Fixed in v0.7.1. The agent filter is now propagated through chain walking and cluster expansion. If you are on an earlier version, upgrade.
- The `maxSkippedConsecutive` parameter (default 5) controls how far chains wander through non-matching agents. Lower values produce stricter filtering but may miss relevant cross-agent context.

### Dead-end files appearing in results

- Dead-end detection runs during ingestion. Files already ingested before dead-end filtering was added (pre-v0.7.0) may contain stub data. Re-ingest affected sessions to clean up.

## See Also

- [How It Works](how-it-works.md) --- Architecture overview including team edge types
- [MCP Tools Reference](../reference/mcp-tools.md) --- Full parameter documentation for all tools
- [Configuration Reference](../reference/configuration.md) --- Tuning traversal depth and token budgets
