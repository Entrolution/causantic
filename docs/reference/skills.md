# Skills Reference

Reference documentation for Causantic's Claude Code skills (slash commands).

## Installation

Skills are installed by `causantic init` to `~/.claude/skills/causantic-<name>/SKILL.md`. They work as slash commands in Claude Code and orchestrate the underlying MCP tools with structured prompts tailored to each use case.

## Available Skills

### Core Retrieval

#### `/causantic-recall [query]`

Reconstruct how something happened — walks backward through causal chains ("how did we solve X?")

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Natural language question about past work |
| `project` | No | Filter to a specific project slug |

**When to use**: User asks about past work, previous decisions, errors solved before, or context from prior sessions. Before saying "I don't have context from previous sessions" -- always try recall first.

**Example**: `/causantic-recall authentication implementation decisions`

---

#### `/causantic-search [query]`

Broad discovery — find everything memory knows about a topic ("what do I know about X?")

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | What to search for in memory |
| `project` | No | Filter to a specific project slug |

**When to use**: Broad discovery, finding past context on a topic, as a starting point before using `recall` for deeper narrative.

**Example**: `/causantic-search database migration patterns`

---

#### `/causantic-predict <context>`

Surface what came after similar past situations — walks forward through causal chains ("what's likely relevant next?")

| Parameter | Required | Description |
|-----------|----------|-------------|
| `context` | Yes | Concise summary of the current task or topic |
| `project` | No | Filter to a specific project slug |

**When to use**: At the start of complex tasks to check for relevant prior work, when encountering patterns that might have been solved before.

**Example**: `/causantic-predict refactoring the auth module`

---

### Understanding & Analysis

#### `/causantic-explain [question or area]`

Answer "why" questions using memory + codebase ("why does X work this way?")

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | A "why" question or area/module name |
| `project` | No | Filter to a specific project slug |

**Modes**:
- **Focused decision**: "Why does X..." / "What led to..." -- returns decision narrative (context, alternatives, rationale, trade-offs)
- **Area briefing**: "Tell me about X" / area name / file path -- returns comprehensive briefing (purpose, key decisions, evolution, constraints)

**Example**: `/causantic-explain why does the chunker split on tool boundaries?`

---

#### `/causantic-debug [error message]`

Search past sessions for prior encounters with the current error, bug pattern, or issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `error` | No | Error text. If omitted, auto-extracts from the current conversation |

**When to use**: When stuck on an error after 2 failed attempts, debugging a recurring problem, or encountering a familiar-looking issue.

**Example**: `/causantic-debug SQLITE_BUSY database is locked`

---

### Session & Project Navigation

#### `/causantic-resume [topic or time range]`

Resume interrupted work -- start-of-session briefing.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `topic` | No | Topic to focus on, or time reference ("yesterday", "last week") |

**When to use**: Start of a session, user asks "where did I leave off?"

**Example**: `/causantic-resume the API refactor`

---

#### `/causantic-reconstruct [time range]`

Replay a past session chronologically by time range.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `time range` | No | Natural language time reference ("yesterday", "past 3 days", "session abc123") |

**When to use**: "What did I work on yesterday?", "Show me the last session", rebuilding context from a specific time period.

**Example**: `/causantic-reconstruct past 3 days`

---

#### `/causantic-summary [time range]`

Factual recap of what was done across recent sessions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `time range` | No | Natural language time reference. Defaults to past 3 days |

**When to use**: Sprint reviews, daily standups, tracking accomplishments and in-progress work.

**Output includes**: Accomplishments, in-progress work, patterns, blockers, next steps.

**Example**: `/causantic-summary this week`

---

#### `/causantic-list-projects`

Discover available projects in memory with chunk counts and date ranges.

**When to use**: Before using project-filtered queries, checking what's been ingested, verifying memory coverage.

**Example**: `/causantic-list-projects`

---

#### `/causantic-status`

Check system health and memory statistics.

**When to use**: After running `causantic init` to verify hooks are firing, when memory seems stale, diagnosing setup issues.

**Output includes**: Version, hook status, memory statistics, per-project breakdowns.

**Example**: `/causantic-status`

---

### Cross-cutting Analysis

#### `/causantic-crossref [pattern]`

Search across all projects for reusable patterns and solutions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `pattern` | Yes | Pattern or topic to search for across projects |

**When to use**: Looking for how something was solved in other projects, cross-project knowledge transfer, finding reusable patterns.

**Example**: `/causantic-crossref rate limiting implementation`

---

#### `/causantic-retro [time range or topic]`

Surface recurring patterns, problems, and decisions across sessions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `scope` | No | Time range or topic. Defaults to past 30 days |

**When to use**: Sprint retrospectives, identifying recurring themes, reviewing work patterns.

**Output includes**: Recurring patterns, decisions made, recurring issues, observations.

**Example**: `/causantic-retro past month`

---

#### `/causantic-cleanup`

Memory-informed codebase review and cleanup plan.

**When to use**: Comprehensive codebase review combining code analysis with historical context from memory. Produces a plan (enters planning mode), not immediate changes.

**Phases**: Discovery, memory context gathering, documentation review, pattern analysis, testability analysis, cleanup plan creation.

**Example**: `/causantic-cleanup`

---

### Memory Management

#### `/causantic-forget [query or filters]`

Delete memory by topic, time range, or session. Always previews before deleting.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | No | Semantic query for topic-based deletion |
| `threshold` | No | Similarity threshold (0--1, default 0.6). Higher = more selective |
| `before` | No | Delete chunks before this ISO 8601 date |
| `after` | No | Delete chunks on or after this ISO 8601 date |
| `session_id` | No | Delete chunks from a specific session |
| `project` | Yes | Project slug (derived from cwd or asked) |

**Workflow**: Always previews first (dry-run), shows what would be deleted, waits for explicit user confirmation before deleting.

**When to use**: User asks to forget, remove, or clean up specific memory. Memory contains incorrect or outdated information.

**Examples**:
- `/causantic-forget authentication flow` -- delete memory about authentication
- `/causantic-forget everything before January` -- time-based deletion
- `/causantic-forget session abc12345` -- delete a specific session

---

## Quick Decision Guide

| User intent | Skill |
|-------------|-------|
| "What do I know about X?" | `search` |
| "How did we solve X?" | `recall` |
| "Why does X work this way?" | `explain` |
| "What might be relevant?" | `predict` |
| "Where did I leave off?" | `resume` |
| "What did I work on yesterday?" | `reconstruct` |
| "Summarize this week" | `summary` |
| "How did other projects handle X?" | `crossref` |
| "What patterns do I see?" | `retro` |
| "Review and clean up this codebase" | `cleanup` |
| "Forget/delete memory about X" | `forget` |

## Skill vs MCP Tool

Skills are user-facing wrappers that guide Claude on how to use the underlying MCP tools. Users invoke skills via slash commands (e.g., `/causantic-recall`); the skill template instructs Claude on which MCP tool(s) to call, what parameters to pass, and how to format the output.

For direct MCP tool documentation, see the [MCP Tools Reference](mcp-tools.md).
